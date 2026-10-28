import { access, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { abort, atomicJson, commandFailure, exists, explain, parseJsonBytes, readJson, redact, relativePath, run, safePath, SyncError, type Run } from "./io.ts";
import { cleanKnown, collectResources, compatible, CONFIG_FILES, credentialFile, defaultRoots, normalizeRoots, object, portableSettings,
  preserveAuth, readOptional, restoreSettings, validateRoot, validateSnapshot, type Snapshot } from "./profile.ts";

interface Config { repository: string; branch: string; roots: string[] }
interface Entry { path: string; staged: string | null; old: boolean }
interface Journal { id: string; stage: string; roots: string[]; entries: Entry[]; state: "applying" | "complete" | "rolled-back" }
export interface SyncOptions {
  agentDir: string;
  version: string;
  run?: Run;
  rename?: typeof rename;
  git?: string;
  pi?: string;
}

export class Sync {
  root: string;
  work: string;
  stage = "预检";
  backup: string | undefined;
  impact = "本机受管配置未修改；远端未更新。";
  secrets: string[] = [];
  warnings: string[] = [];
  signal: AbortSignal;
  options: SyncOptions;
  execute: Run;
  move: typeof rename;

  constructor(options: SyncOptions, signal: AbortSignal) {
    this.options = options;
    this.root = resolve(options.agentDir);
    this.work = join(this.root, "sync");
    this.signal = signal;
    this.execute = options.run ?? run;
    this.move = options.rename ?? rename;
  }

  async process(command: string, args: string[], options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv; timeout?: number; allowFailure?: boolean; recovery?: boolean } = {}) {
    if (!options.recovery) abort(this.signal);
    const result = await this.execute(command, args, { cwd: options.cwd ?? this.root, signal: options.recovery ? undefined : this.signal,
      input: options.input, timeout: options.timeout, env: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never",
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes", ...options.env } });
    if (result.code !== 0 && !options.allowFailure) throw commandFailure(command, result);
    return result;
  }

  async git(args: string[], options: Parameters<Sync["process"]>[2] = {}) {
    return this.process(this.options.git ?? "git", ["--git-dir", join(this.work, "repository.git"), ...args], options);
  }

  async preflight(needsGit = true) {
    if (!compatible(this.options.version)) throw new SyncError(`当前 Pi ${this.options.version} 不支持；需要 Pi 1.4.x 稳定版。`, "请自行切换到支持的 Pi 版本；Pi Sync 不自动升级 Pi。");
    if (!(await lstat(this.root)).isDirectory()) throw new SyncError("Agent Directory 不是目录。");
    await access(this.root, constants.R_OK | constants.W_OK);
    await safePath(this.root, "sync");
    await mkdir(this.work, { recursive: true, mode: 0o700 });
    if (needsGit) {
      const gitVersion = (await this.process(this.options.git ?? "git", ["--version"])).stdout.match(/git version (\d+)\.(\d+)/);
      if (!gitVersion || Number(gitVersion[1]) < 2 || (Number(gitVersion[1]) === 2 && Number(gitVersion[2]) < 28)) throw new SyncError("需要 Git 2.28 或以上版本，当前命令版本不满足或不可识别。", "自行更新 Git 后重新打开终端和 Pi；Pi Sync 不自动安装 Git。");
    }
  }

  async locked<T>(action: () => Promise<T>, recovery = false, needsGit = true) {
    await this.preflight(needsGit);
    const lockPath = join(this.work, "operation.lock");
    let handle;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { handle = await open(lockPath, "wx", 0o600); break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const lock = await readJson(lockPath);
        if (!Number.isSafeInteger(lock.pid) || Number(lock.pid) < 1) throw new SyncError("同步锁记录无效。", "确认没有同步操作正在运行后，删除 Agent Directory 中 sync/operation.lock 再重试。");
        try { process.kill(Number(lock.pid), 0); throw new SyncError(`已有同步操作正在运行（PID ${lock.pid}）。`, "等待该操作完成，或在原会话执行 /sync cancel。"); }
        catch (caught) { if ((caught as NodeJS.ErrnoException).code !== "ESRCH") throw caught; }
        await rm(lockPath);
      }
    }
    if (!handle) throw new SyncError("无法取得同步锁，请重试。");
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
    await handle.close();
    try {
      if (!recovery && await exists(join(this.work, "active.json"))) throw new SyncError("上次还原中断，有待恢复的操作记录。", "先运行 /sync recover 回退到备份状态；不要手动删除备份。");
      abort(this.signal);
      return await action();
    } finally { await rm(lockPath, { force: true }); }
  }

  async config(): Promise<Config> {
    const value = await readJson(join(this.work, "config.json"), {});
    if (typeof value.repository !== "string" || typeof value.branch !== "string" || !Array.isArray(value.roots)
      || value.roots.some((root) => typeof root !== "string")) throw new SyncError("尚未配置有效的同步仓库。", "先运行 /sync setup <仓库地址> [分支]；带空格的参数用引号包裹。");
    this.checkRemote(value.repository);
    normalizeRoots(value.roots as string[]);
    return value as unknown as Config;
  }

  checkRemote(repository: string) {
    if (!repository || repository.startsWith("-") || /[\x00-\x1f]/.test(repository)) throw new SyncError("仓库来源格式无效。");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repository)) {
      const url = new URL(repository);
      if (url.password || (url.protocol !== "ssh:" && url.username) || [...url.searchParams.keys()].some((key) => /token|key|password|secret/i.test(key))) {
        throw new SyncError("仓库地址不能内嵌凭据。", "使用本机 Git 凭据管理器或 SSH Key，再提供不含凭据的地址。");
      }
      if (!["https:", "http:", "ssh:", "git:", "file:"].includes(url.protocol)) throw new SyncError("仓库协议不支持。");
    }
  }

  async initCache() {
    const path = join(this.work, "repository.git");
    await safePath(this.root, "sync/repository.git");
    if (!await exists(path)) await this.process(this.options.git ?? "git", ["init", "--bare", path]);
    else if ((await this.process(this.options.git ?? "git", ["--git-dir", path, "rev-parse", "--is-bare-repository"])).stdout.trim() !== "true") throw new SyncError("同步缓存不是有效的 bare Git 仓库。", "保留备份后修复 sync/repository.git；不要把用户工作仓库直接放在此位置。");
  }

  async remote(config: Config, recovery = false) {
    const result = await this.git(["ls-remote", config.repository, `refs/heads/${config.branch}`], { recovery, timeout: recovery ? 10_000 : undefined });
    return result.stdout.match(/^([0-9a-f]{40,64})\s/m)?.[1];
  }

  async fetch(config: Config) {
    this.stage = "读取远端历史";
    const parent = await this.remote(config);
    if (!parent) {
      const heads = await this.git(["ls-remote", "--heads", config.repository]);
      if (heads.stdout.trim()) throw new SyncError(`目标分支不存在：${config.branch}`, "检查远端分支是否被删除或改名，再用 /sync setup 重新选择。");
      return undefined;
    }
    await this.git(["fetch", "--no-tags", config.repository, `+refs/heads/${config.branch}:refs/remotes/pi-sync/${config.branch}`]);
    return (await this.git(["rev-parse", `refs/remotes/pi-sync/${config.branch}`])).stdout.trim();
  }

  async setup(repository: string, branch?: string, cwd = this.root) {
    this.stage = "连接仓库";
    if (!repository) throw new SyncError("缺少仓库地址。", "用法：/sync setup <仓库地址> [分支]。");
    this.checkRemote(repository);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(repository) && !/^[^/\\]+@[^:]+:/.test(repository)) repository = resolve(cwd, repository);
    const listed = await this.process(this.options.git ?? "git", ["ls-remote", "--symref", repository, "HEAD"]);
    const chosen = branch ?? listed.stdout.match(/^ref: refs\/heads\/([^\s]+)\s+HEAD/m)?.[1] ?? "main";
    await this.process(this.options.git ?? "git", ["check-ref-format", "--branch", chosen]);
    const refs = await this.process(this.options.git ?? "git", ["ls-remote", "--heads", repository]);
    if (refs.stdout.trim() && !refs.stdout.split(/\r?\n/).some((line) => line.endsWith(`refs/heads/${chosen}`))) throw new SyncError(`仓库可读取，但目标分支不存在：${chosen}`, "选择存在的分支重新 setup；空仓库允许第一次保存时创建分支。");
    const previous = await readJson(join(this.work, "config.json"), {});
    const roots = Array.isArray(previous.roots) && previous.roots.every((root) => typeof root === "string") ? previous.roots as string[] : await defaultRoots(this.root);
    await this.initCache();
    await atomicJson(join(this.work, "config.json"), { repository, branch: chosen, roots: normalizeRoots(roots) });
    return `仓库连接成功：可读取；分支 ${chosen}。${refs.stdout.trim() ? "" : "仓库尚无快照，可先保存。"}写权限尚未验证，首次成功推送后才能确认。`;
  }

  async select(path: string, include: boolean) {
    const config = await this.config();
    path = path.replace(/\\/g, "/").replace(/^\.\//, "");
    validateRoot(path);
    await safePath(this.root, path);
    if (!include && config.roots.some((root) => path.startsWith(root + "/"))) throw new SyncError("该路径仍被父受管根覆盖。", "先 exclude 父受管根，再分别 include 需要的子路径；声明中的本地扩展资源仍需配套保存。");
    config.roots = normalizeRoots(include ? [...config.roots, path] : config.roots.filter((root) => root !== path));
    await atomicJson(join(this.work, "config.json"), config);
    return `${include ? "已纳入" : "已取消纳入"}资源：${path}。当前 ${config.roots.length} 个受管根；下次保存生效。`;
  }

  manager(settings: Record<string, unknown>, agentDir = this.root) {
    return new DefaultPackageManager({ cwd: agentDir, agentDir, settingsManager: SettingsManager.inMemory(settings) });
  }

  source(entry: unknown) {
    const source = typeof entry === "string" ? entry : object(entry) ? entry.source : undefined;
    if (typeof source !== "string" || !source || source.startsWith("-")) throw new SyncError("扩展来源声明无效。");
    if (object(entry)) for (const key of ["extensions", "skills", "prompts", "themes"]) {
      if (entry[key] !== undefined && (!Array.isArray(entry[key]) || (entry[key] as unknown[]).some((value) => typeof value !== "string"))) throw new SyncError(`扩展筛选 ${key} 必须是字符串数组。`);
    }
    return source;
  }

  async pinPackages(settings: Record<string, unknown>, roots: string[]) {
    if (settings.packages === undefined) return [];
    if (!Array.isArray(settings.packages)) throw new SyncError("packages 必须是数组。");
    const manager = this.manager(settings);
    const packages: unknown[] = [];
    for (const entry of settings.packages) {
      abort(this.signal);
      const source = this.source(entry);
      let pinned: string;
      const installed = manager.getInstalledPath(source, "user");
      if (!installed || !await exists(installed)) throw new SyncError(`扩展未安装，不能确认实际版本：${source}`, "先在源机器安装并验证该扩展，再保存；不会改用最新版本。");
      this.stage = `固定扩展 ${source}`;
      if (source.startsWith("npm:")) {
        const manifest = await readJson(join(installed, "package.json"));
        if (typeof manifest.name !== "string" || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(manifest.name)
          || typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(manifest.version)) throw new SyncError("已安装 npm 包缺少有效名称或确定版本。");
        pinned = `npm:${manifest.name}@${manifest.version}`;
      } else if (/^(git:|https?:\/\/|ssh:\/\/|git@)/.test(source)) {
        const state = await this.process(this.options.git ?? "git", ["-C", installed, "status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
        const changes = state.stdout.split("\0").filter(Boolean);
        const edits = changes.filter((change) => !(change.startsWith("?? ") && /^(node_modules\/|package-lock\.json$|pnpm-lock\.yaml$|bun\.lockb?$)/.test(change.slice(3))));
        if (edits.length) throw new SyncError(`已安装 Git 扩展含本机修改：${source}`, "先提交并推送修改，或将源码作为本地资源纳入；仅固定 commit 无法保存未提交内容。");
        if (changes.length) this.warnings.push("Git 扩展未跟踪的依赖目录和包管理器锁文件按安装产物处理；固定 commit 不保证全部传递依赖一致。");
        const commit = (await this.process(this.options.git ?? "git", ["-C", installed, "rev-parse", "HEAD"])).stdout.trim();
        const origin = (await this.process(this.options.git ?? "git", ["-C", installed, "config", "--get", "remote.origin.url"])).stdout.trim();
        this.checkRemote(origin);
        if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new SyncError("Git 扩展 commit 无效。");
        pinned = `git:${origin}@${commit}`;
      } else {
        const local = relative(this.root, resolve(installed)).split(sep).join("/");
        if (!local || local.startsWith("../") || isAbsolute(local)) { this.warnings.push("未覆盖目录外的本地扩展来源。"); continue; }
        validateRoot(local);
        await safePath(this.root, local);
        roots.push(local);
        pinned = `./${local}`;
      }
      packages.push(typeof entry === "string" ? pinned : { ...entry, source: pinned });
    }
    return packages;
  }

  async collect(config: Config): Promise<Snapshot> {
    this.stage = "收集并过滤本机配置";
    const settings = await readOptional(this.root, "settings.json") ?? {};
    const roots = [...config.roots];
    const packages = await this.pinPackages(settings, roots);
    const portable = portableSettings(settings, this.warnings);
    portable.packages = packages;
    for (const key of ["extensions", "skills", "prompts", "themes"]) {
      for (const input of (portable[key] as string[] | undefined) ?? []) {
        const path = input.replace(/^[!+-]/, "").replace(/^\.\//, "");
        if (path.startsWith("builtin:") || /[*?[\]{}]/.test(path)) { if (!path.startsWith("builtin:")) this.warnings.push(`通配资源引用 ${key} 需确保其根已显式 include。`); continue; }
        if (path && await exists(join(this.root, path))) roots.push(validateRoot(path));
      }
    }
    const normalized = normalizeRoots(roots);
    const profile: Snapshot = {
      format: 1, piVersion: this.options.version, createdAt: new Date().toISOString(),
      settings: cleanKnown(portable, this.secrets, this.warnings) as Record<string, unknown>,
      models: cleanKnown(await readOptional(this.root, "models.json"), this.secrets, this.warnings) as Snapshot["models"],
      mcp: cleanKnown(await readOptional(this.root, "mcp.json"), this.secrets, this.warnings) as Snapshot["mcp"],
      keybindings: await readOptional(this.root, "keybindings.json"), roots: normalized,
      files: await collectResources(this.root, normalized, this.signal, this.secrets, this.warnings),
    };
    return validateSnapshot(profile);
  }

  async save() {
    const config = await this.config();
    await this.initCache();
    const profile = await this.collect(config);
    const serialized = JSON.stringify(profile, null, 2) + "\n";
    await atomicJson(join(this.work, "pending-save.json"), profile);
    this.impact = "本机快照已生成；本机受管配置未修改，远端尚未更新。";
    for (let attempt = 0; attempt < 3; attempt++) {
      const parent = await this.fetch(config);
      this.stage = "提交本机快照";
      const env = { GIT_INDEX_FILE: join(this.work, `index-${randomUUID()}`) };
      try {
        await this.git(parent ? ["read-tree", parent] : ["read-tree", "--empty"], { env });
        const blob = (await this.git(["hash-object", "-w", "--stdin"], { input: serialized })).stdout.trim();
        await this.git(["update-index", "--add", "--cacheinfo", "100644", blob, "profile.json"], { env });
        const tree = (await this.git(["write-tree"], { env })).stdout.trim();
        const commit = (await this.git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `Pi Sync ${profile.createdAt}`])).stdout.trim();
        await atomicJson(join(this.work, "pending-commit.json"), { commit, repository: config.repository, branch: config.branch });
        this.stage = "推送快照";
        this.impact = "本机快照已生成；推送结果尚待确认，本机受管配置未修改。";
        let failure: unknown;
        try {
          const result = await this.git(["push", config.repository, `${commit}:refs/heads/${config.branch}`], { allowFailure: true });
          if (!result.code) {
            this.impact = "远端已更新；本机受管配置未修改。";
            await atomicJson(join(this.work, "last-save.json"), { commit, createdAt: profile.createdAt });
            return `保存成功：远端已更新，commit ${commit.slice(0, 12)}。固定扩展 ${(profile.settings.packages as unknown[]).length} 个，用户资源 ${profile.files.length} 个；旧版本保留在 Git 历史。`;
          }
          failure = commandFailure(this.options.git ?? "git", result);
        } catch (error) { failure = error; }
        let remote: string | undefined;
        try { remote = await this.remote(config, true); } catch {
          throw new SyncError("推送连接中断，无法确认远端是否已接收本次快照。", "远端结果未知；恢复网络后运行 /sync status 检查远端与待确认 commit，再决定是否重新保存。");
        }
        if (remote === commit) {
          this.impact = "已查询确认远端接收了本次快照；本机受管配置未修改。";
          await atomicJson(join(this.work, "last-save.json"), { commit, createdAt: profile.createdAt });
          return `保存成功：推送回执异常，但已确认远端 commit ${commit.slice(0, 12)}。`;
        }
        this.impact = "本机快照已生成；远端当前不是本次 commit，本机受管配置未修改。";
        if (this.signal.aborted) abort(this.signal);
        if (remote !== parent) {
          if (attempt < 2) continue;
          throw new SyncError("远端持续发生并发更新，三次保存尝试均未完成。", "稍后重试；远端历史保留，本机快照位于 sync/pending-save.json。");
        }
        throw failure;
      } finally { await rm(env.GIT_INDEX_FILE, { force: true }); await rm(env.GIT_INDEX_FILE + ".lock", { force: true }); }
    }
    throw new SyncError("远端持续发生并发更新，三次保存尝试均未完成。", "稍后重试；已有远端历史保留，本机快照位于 sync/pending-save.json。");
  }

  async readSnapshot(config: Config) {
    await this.initCache();
    const commit = await this.fetch(config);
    if (!commit) throw new SyncError("仓库可读取，但目标分支还没有环境快照。", "先在源机器执行 /sync save，再到目标机器还原。");
    const content = await this.git(["show", `${commit}:profile.json`], { allowFailure: true });
    if (content.code) throw new SyncError("远端提交没有可识别的 Pi Sync 环境快照。", "请在源机器使用 Pi Sync 保存；不会把旧的整目录备份直接当作快照还原。");
    let value: unknown;
    try { value = JSON.parse(content.stdout); } catch { throw new SyncError("远端快照 JSON 格式无效；未输出正文。"); }
    return { profile: validateSnapshot(value), commit };
  }

  async packageCommand(settings: Record<string, unknown>, cwd: string, signal = this.signal) {
    const command = settings.npmCommand ?? ["npm"];
    if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== "string" || !part)) throw new SyncError("本机 npmCommand 必须是非空命令参数数组。");
    const candidates = command.map((part) => part.split(/[\\/]/).at(-1)!.replace(/\.(cmd|exe|ps1)$/i, "")).filter((part) => ["npm", "pnpm", "bun"].includes(part));
    const manager = candidates.at(-1) ?? "npm";
    if (manager !== "bun") {
      const node = await this.execute("node", ["--version"], { cwd, signal, timeout: 30_000 });
      if (node.code) throw commandFailure("node", node);
      const version = node.stdout.trim().match(/^v?(\d+)\.(\d+)/);
      if (!version || Number(version[1]) < 22 || (Number(version[1]) === 22 && Number(version[2]) < 19)) throw new SyncError("当前安装路径需要 Node.js 22.19 或以上版本。", "检查当前 PATH 中的 Node.js；Bun 安装路径不要求额外系统 Node。");
    }
    const result = await this.execute(command[0], [...command.slice(1), "--version"], { cwd, signal, timeout: 30_000 });
    if (result.code) throw commandFailure(command[0], result);
    const args = manager === "bun" ? ["install", "--omit=dev", "--omit=peer"] : manager === "pnpm"
      ? ["install", "--prod", "--config.auto-install-peers=false", "--config.strict-peer-dependencies=false", "--config.strict-dep-builds=false"]
      : ["install", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund"];
    return { command: command[0], args: [...command.slice(1), ...args] };
  }

  async prepare(profile: Snapshot, stageRoot: string, localSettings: Record<string, unknown>) {
    this.stage = "准备扩展和依赖";
    const stagedAgent = join(stageRoot, "agent");
    await mkdir(stagedAgent, { recursive: true });
    const packages = (profile.settings.packages as unknown[] | undefined) ?? [];
    const remotePackages = packages.map((entry) => this.source(entry)).filter((source) => !source.startsWith("./"));
    const artifacts: string[] = [];
    if (remotePackages.length) {
      await this.packageCommand(localSettings, stageRoot);
      const piVersion = (await this.process(this.options.pi ?? "pi", ["--version"])).stdout.trim();
      if (!compatible(piVersion)) throw new SyncError(`用于安装的 Pi 命令版本 ${piVersion} 不支持。`, "将当前 PATH 中的 Pi 切换为 1.4.x 稳定版，再重试还原。");
      await atomicJson(join(stagedAgent, "settings.json"), localSettings.npmCommand ? { npmCommand: localSettings.npmCommand } : {});
      for (const source of remotePackages) {
        if (source.startsWith("npm:")) {
          if (!/^npm:(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(source)) throw new SyncError("快照 npm 来源没有固定的确定版本。");
        } else if (!source.startsWith("git:") || !/@[0-9a-f]{40,64}$/.test(source)) throw new SyncError("快照 Git 来源没有固定 commit。");
        this.checkRemote(source.replace(/^git:/, "").replace(/@[0-9a-f]{40,64}$/, ""));
        this.stage = `安装扩展 ${source}`;
        await this.process(this.options.pi ?? "pi", ["install", source], { cwd: stageRoot, timeout: 300_000,
          env: { PI_CODING_AGENT_DIR: stagedAgent, PI_CODING_AGENT_SESSION_DIR: join(stageRoot, "sessions"), PI_OFFLINE: "1", CI: "1" } });
        const installed = this.manager(localSettings, stagedAgent).getInstalledPath(source, "user");
        if (!installed || !await exists(installed)) throw new SyncError(`安装命令结束，但未找到固定扩展：${source}`);
        if (source.startsWith("npm:")) {
          const manifest = await readJson(join(installed, "package.json"));
          if (`npm:${manifest.name}@${manifest.version}` !== source) throw new SyncError(`安装后的扩展版本与快照不一致：${source}`);
        } else {
          const actual = (await this.process(this.options.git ?? "git", ["-C", installed, "rev-parse", "HEAD"])).stdout.trim();
          if (!source.endsWith(`@${actual}`)) throw new SyncError(`安装后的 Git commit 与快照不一致：${source}`);
        }
      }
      for (const name of ["npm", "git"]) if (await exists(join(stagedAgent, name))) artifacts.push(name);
    }
    return { stagedAgent, artifacts };
  }

  async recoverJournal(journal: Journal) {
    this.stage = "回退受管内容";
    const backup = await safePath(this.root, `sync/backups/${journal.id}`);
    this.backup = backup;
    if (!/^[0-9a-f-]{36}$/.test(journal.id) || journal.stage !== `staging/${journal.id}` || !Array.isArray(journal.entries)
      || !Array.isArray(journal.roots) || journal.roots.some((root) => typeof root !== "string")) throw new SyncError("还原日志无效，不能自动恢复。");
    const roots = normalizeRoots(journal.roots);
    const entryPaths = new Set<string>();
    for (const entry of journal.entries) {
      if (!object(entry) || typeof entry.path !== "string" || !(entry.staged === null || typeof entry.staged === "string") || typeof entry.old !== "boolean") throw new SyncError("还原日志中的条目无效。");
      relativePath(entry.path);
      if (entry.staged) relativePath(entry.staged);
      if (credentialFile(entry.path) || (!CONFIG_FILES.includes(entry.path as typeof CONFIG_FILES[number])
        && !["npm", "git", "sync/config.json", "sync/last-restore.json"].includes(entry.path)
        && !roots.some((root) => entry.path === root || entry.path.startsWith(root + "/")))) throw new SyncError("还原日志试图修改受管范围外的内容。");
      if (entryPaths.has(entry.path.toLowerCase())) throw new SyncError("还原日志中存在重复目标。");
      entryPaths.add(entry.path.toLowerCase());
    }
    for (const entry of [...journal.entries].reverse()) {
      relativePath(entry.path);
      if (entry.path.startsWith("sync/") && !["sync/config.json", "sync/last-restore.json"].includes(entry.path)) throw new SyncError("还原日志试图修改内部工作资料。");
      const target = await safePath(this.root, entry.path);
      const old = await safePath(backup, `original/${entry.path}`);
      const staged = entry.staged ? await safePath(join(this.work, journal.stage), entry.staged) : undefined;
      const backedUp = await exists(old);
      const appliedNew = !entry.old && staged && !await exists(staged);
      if (backedUp || appliedNew) {
        if (await exists(target)) {
          const failed = await safePath(backup, `failed/${entry.path}`);
          await mkdir(dirname(failed), { recursive: true });
          await this.move(target, failed);
        }
        if (backedUp) { await mkdir(dirname(target), { recursive: true }); await this.move(old, target); }
      }
    }
    journal.state = "rolled-back";
    await atomicJson(join(backup, "journal.json"), journal);
    await rm(join(this.work, "active.json"), { force: true });
    this.impact = "本机受管文件和声明已回退；远端未修改。下载缓存可保留，安装脚本的外部副作用不在回退范围。";
  }

  async recover() {
    const path = join(this.work, "active.json");
    if (!await exists(path)) return "没有待恢复的中断操作。";
    const journal = await readJson(path) as unknown as Journal;
    if (journal.state === "complete") { await rm(path); return "上次还原已经完成，仅清除了完成标记；请重启 Pi。"; }
    await this.recoverJournal(journal);
    return `恢复成功：已回退本机受管内容。备份与失败现场：${this.backup}`;
  }

  async restore() {
    const config = await this.config();
    const { profile, commit } = await this.readSnapshot(config);
    const id = randomUUID();
    const stageRoot = join(this.work, "staging", id);
    await safePath(this.root, `sync/staging/${id}`);
    await mkdir(stageRoot, { recursive: true });
    const localSettings = await readOptional(this.root, "settings.json") ?? {};
    const { artifacts } = await this.prepare(profile, stageRoot, localSettings);
    this.stage = "准备受管文件";
    const previous = await readJson(join(this.work, "last-restore.json"), {});
    const oldRoots = Array.isArray(previous.roots) && previous.roots.every((root) => typeof root === "string") ? normalizeRoots(previous.roots as string[]) : [];
    const allRoots = normalizeRoots([...profile.roots, ...oldRoots]);
    const oldFiles = await collectResources(this.root, allRoots, this.signal, this.secrets, this.warnings);
    const stagedFiles = new Map<string, string | null>();
    const stageFile = async (path: string, content: string | Buffer | null, executable = false) => {
      if (content === null) { stagedFiles.set(path, null); return; }
      const key = `files/${path}`;
      const target = await safePath(stageRoot, key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { mode: executable ? 0o700 : 0o600 });
      stagedFiles.set(path, key);
    };
    for (const file of oldFiles) stagedFiles.set(file.path, null);
    for (const file of profile.files) {
      abort(this.signal);
      let content = Buffer.from(file.content, "base64");
      if (/\.json$/i.test(file.path)) {
        let value = parseJsonBytes(content, file.path);
        const localPath = await safePath(this.root, file.path);
        const local = await exists(localPath) ? parseJsonBytes(await readFile(localPath), file.path) : {};
        value = preserveAuth(cleanKnown(value, this.secrets, this.warnings), local);
        if (file.path === "pi-fff.json" && object(value) && object(local)) for (const key of ["frecencyDbPath", "historyDbPath"]) if (local[key] !== undefined) value[key] = local[key];
        content = Buffer.from(JSON.stringify(value, null, 2) + "\n");
      }
      await stageFile(file.path, content, file.executable);
    }
    for (const name of CONFIG_FILES) {
      const incoming = name === "settings.json" ? profile.settings : name === "models.json" ? profile.models : name === "mcp.json" ? profile.mcp : profile.keybindings;
      const local = await readOptional(this.root, name) ?? {};
      const filtered = cleanKnown(incoming, this.secrets, this.warnings);
      const value = name === "settings.json" ? restoreSettings(filtered as Record<string, unknown>, local) : preserveAuth(filtered, local);
      await stageFile(name, value === null ? null : JSON.stringify(value, null, 2) + "\n");
    }
    for (const name of artifacts) stagedFiles.set(name, `agent/${name}`);
    const localRoots = [...new Set([...packagesLocalRoots(profile.settings.packages), ...profile.files.filter((file) => file.path.endsWith("/package.json")).map((file) => file.path.slice(0, -"/package.json".length))])];
    for (const root of localRoots) {
      const packagePath = join(stageRoot, "files", ...root.split("/"), "package.json");
      if (!await exists(packagePath)) continue;
      const manifest = await readJson(packagePath);
      if (!object(manifest.dependencies) || !Object.keys(manifest.dependencies).length) continue;
      this.stage = `准备本地扩展依赖 ${root}`;
      const cwd = dirname(packagePath);
      const npm = await this.packageCommand(localSettings, cwd);
      await this.process(npm.command, npm.args, { cwd, timeout: 300_000 });
      if (await exists(join(cwd, "node_modules"))) stagedFiles.set(`${root}/node_modules`, `files/${root}/node_modules`);
    }
    await stageFile("sync/config.json", JSON.stringify({ ...config, roots: profile.roots }, null, 2) + "\n");
    await stageFile("sync/last-restore.json", JSON.stringify({ roots: profile.roots, commit, backup: id }, null, 2) + "\n");
    const entries: Entry[] = [];
    for (const [path, staged] of stagedFiles) {
      const target = await safePath(this.root, path);
      const old = await exists(target);
      if (old && (await lstat(target)).isDirectory() && staged?.startsWith("files/") && !path.endsWith("/node_modules")) throw new SyncError(`目标目录与快照文件发生冲突：${path}`, "保留该目录后手动调整冲突，再重试还原。");
      entries.push({ path, staged, old });
    }
    this.stage = "创建还原备份";
    const backup = await safePath(this.root, `sync/backups/${id}`);
    await mkdir(backup, { recursive: true, mode: 0o700 });
    await atomicJson(join(backup, "journal.json"), { id, stage: `staging/${id}`, roots: allRoots, entries, state: "applying" });
    this.backup = backup;
    const journal: Journal = { id, stage: `staging/${id}`, roots: allRoots, entries, state: "applying" };
    await atomicJson(join(this.work, "active.json"), journal);
    try {
      for (const entry of entries) {
        abort(this.signal);
        if (!entry.old) continue;
        const target = await safePath(this.root, entry.path);
        const destination = await safePath(backup, `original/${entry.path}`);
        await mkdir(dirname(destination), { recursive: true });
        await this.move(target, destination);
        this.impact = "本机受管内容正在替换；旧内容已写入本地备份，远端未修改。";
      }
      this.stage = "应用受管文件";
      for (const entry of entries) {
        abort(this.signal);
        if (!entry.staged) continue;
        const from = await safePath(stageRoot, entry.staged);
        const target = await safePath(this.root, entry.path);
        await mkdir(dirname(target), { recursive: true });
        await this.move(from, target);
      }
      journal.state = "complete";
      await atomicJson(join(backup, "journal.json"), journal);
      await atomicJson(join(this.work, "active.json"), journal);
      await rm(join(this.work, "active.json"));
      this.impact = "磁盘还原完成；远端未修改。";
      return `还原成功：磁盘配置与 ${profile.files.length} 个用户资源已恢复，commit ${commit.slice(0, 12)}。\n备份：${backup}\n待鉴权：未检测或迁移独立凭据，请自行确认供应商/MCP 鉴权。\n待重启：请自行重启 Pi，当前会话未热切换。`;
    } catch (error) {
      const failedStage = this.stage;
      try { await this.recoverJournal(journal); }
      catch (recoveryError) {
        this.impact = `还原及回退未全部完成；受影响项：${entries.map((entry) => entry.path).join("、")}。远端未修改。`;
        throw new SyncError(`${failedStage} 失败：${explain(error).reason}；回退也失败：${explain(recoveryError).reason}`, `先保留备份 ${backup}，运行 /sync recover 重试恢复；仍失败时按 journal.json 的清单手动恢复。`);
      }
      this.stage = failedStage;
      throw error;
    }
  }

  async status() {
    const config = await this.config();
    await this.initCache();
    const remote = await this.remote(config);
    const last = await readJson(join(this.work, "last-restore.json"), {});
    const pending = await readJson(join(this.work, "pending-commit.json"), {});
    return `Pi Sync：Pi ${this.options.version}\n仓库：${config.repository}\n分支：${config.branch}\n远端：${remote ?? "尚无快照"}\n待确认保存：${pending.commit ?? "无"}${pending.commit && remote === pending.commit ? "（已确认远端当前为该 commit）" : ""}\n上次还原备份：${last.backup ? join(this.work, "backups", String(last.backup)) : "无"}\n受管根：${config.roots.join("、")}\n${await exists(join(this.work, "active.json")) ? "有中断操作，请执行 /sync recover。" : "没有待恢复的中断还原。"}`;
  }

  error(error: unknown, action: string) {
    const detail = explain(error);
    return redact(`Pi Sync 失败，操作：${action}，阶段：${this.stage}\n原因：${detail.reason}\n影响：${this.impact}\n备份：${this.backup ?? "本次尚未生成；既有备份未修改"}\n处理：${detail.hint}`, this.secrets);
  }
}

function packagesLocalRoots(packages: unknown) {
  if (!Array.isArray(packages)) return [];
  return packages.flatMap((entry) => {
    const source = typeof entry === "string" ? entry : object(entry) ? entry.source : undefined;
    return typeof source === "string" && source.startsWith("./") ? [validateRoot(source.slice(2))] : [];
  });
}
