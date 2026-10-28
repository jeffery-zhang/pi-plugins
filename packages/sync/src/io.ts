import { spawn } from "node:child_process";
import { access, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeout?: number;
}
export interface RunResult { stdout: string; stderr: string; code: number }
export type Run = (command: string, args: string[], options: RunOptions) => Promise<RunResult>;

export class SyncError extends Error {
  hint: string;
  constructor(message: string, hint = "检查指出的配置、来源或参数，修复后重试；先保留报告的备份。") {
    super(message);
    this.name = "SyncError";
    this.hint = hint;
  }
}

export function abort(signal?: AbortSignal) {
  if (signal?.aborted) throw new SyncError("操作已取消。", "已停止后续步骤；如有受管改动会尝试回退，请查看回退状态。");
}

export function redact(text: string, secrets: string[] = []) {
  let result = text;
  for (const secret of secrets) if (secret.length > 2) result = result.split(secret).join("[已屏蔽]");
  return result.replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[已屏蔽]@")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&\s]*/gi, "$1[已屏蔽]")
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|bearer[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|cookie)["']?\s*[:=]\s*)[^\r\n,}]+/gi, "$1[已屏蔽]");
}

export function explain(error: unknown): { reason: string; hint: string } {
  if (error instanceof SyncError) return { reason: error.message, hint: error.hint };
  const item = error as NodeJS.ErrnoException;
  const code = item?.code;
  const hints: Record<string, string> = {
    ENOENT: "确认所需命令/文件已安装或存在，并检查当前 Pi 进程的 PATH；安装后重新打开终端与 Pi。",
    EACCES: "检查文件权限、命令执行权限和安全软件限制。",
    EPERM: "检查目录权限和文件占用；关闭占用程序后重试。",
    ENOSPC: "释放目标磁盘空间后重试；先保留现有备份。",
    EBUSY: "关闭占用目标文件或目录的程序后重试。",
    ETIMEDOUT: "检查网络、代理及服务端连接后重试。",
  };
  return { reason: `${code ? `${code}: ` : ""}${item?.message ?? String(error)}`, hint: hints[code ?? ""] ?? "检查诊断、受影响项和备份位置后重试。" };
}

export function commandFailure(command: string, result: RunResult): SyncError {
  const details = (result.stderr || result.stdout || "命令没有提供诊断").trim().slice(-5000);
  let hint = "检查当前命令配置和上述诊断后重试。";
  if (/user\.email|user\.name|identity unknown|unable to auto-detect email/i.test(details)) hint = "为当前 Git 账号配置 user.name 和 user.email 后重新保存。";
  else if (/ENOSPC|no space left/i.test(details)) hint = "释放目标磁盘空间，保留现有备份后重试。";
  else if (/EACCES|EPERM|EBUSY|being used by another process|unable to create.*lock/i.test(details)) hint = "检查本地目录写入权限、文件占用和锁；关闭占用程序后重试，保留现有备份。";
  else if (/repository not found|does not appear to be a git repository|could not read from remote repository/i.test(details)) hint = "检查仓库地址是否存在，以及当前 Git 账号是否有读取权限；私有仓库可能用不存在表示无权限。";
  else if (/E401|E403|401|403|protected branch|hook declined|push declined|write access|permission.*denied|authentication failed|publickey|unable to authenticate/i.test(details)) hint = /npm|pnpm|registry|E401|E403/i.test(details)
    ? "检查本机包管理器的 registry、认证配置和私有包读取权限，修复后重试还原。"
    : "检查本机 Git 凭据、SSH Key、仓库读写权限和保护分支策略；使用有权限的账号后重试。";
  else if (/could not resolve|name or service|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timed? out|proxy|certificate|SSL|TLS|host key|connection refused|network/i.test(details)) hint = "根据诊断检查 DNS、连接、代理、TLS 证书或 SSH 主机身份；不要关闭校验来掩盖问题。";
  else if (/ETARGET|notarget|not found|404|unsupported|EBADPLATFORM|EBADENGINE/i.test(details)) hint = "检查包名和固定版本是否存在、包仓库权限、所需运行时以及系统/架构兼容性。";
  return new SyncError(`${command} 执行失败（退出码 ${result.code}）：${details}`, hint);
}

async function executable(command: string, env: NodeJS.ProcessEnv) {
  const suffixes = process.platform === "win32" ? [".exe", ".ps1", ".cmd", ".bat", ""] : [""];
  for (const directory of isAbsolute(command) || /[\\/]/.test(command) ? [""] : (env.PATH ?? env.Path ?? "").split(delimiter)) {
    for (const suffix of suffixes) {
      const candidate = directory ? join(directory, command + suffix) : resolve(command + suffix);
      try { await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); return candidate; } catch { /* try the next PATH entry */ }
    }
  }
  throw new SyncError(`当前 Pi 进程找不到或无法执行命令：${command}`, "检查工具是否安装、执行权限与当前进程 PATH；安装后重新打开终端和 Pi。");
}

const POWERSHELL_CALL = "$ErrorActionPreference='Stop';$PSNativeCommandArgumentPassing='Standard';$s=$env:PI_SYNC_CALL|ConvertFrom-Json;$callArgs=@($s.arguments);& $s.command @callArgs;if($null -ne $LASTEXITCODE){exit $LASTEXITCODE}";

export const run: Run = async (command, args, options) => {
  abort(options.signal);
  const env = { ...process.env, ...options.env };
  let binary = await executable(command, env);
  let nativeArgs = args;
  // Bare batch wrappers reparse metacharacters; use the package manager's PowerShell shim.
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    const shim = binary.replace(/\.(cmd|bat)$/i, ".ps1");
    if (!await exists(shim)) throw new SyncError("无法安全运行没有 PowerShell shim 的批处理入口。", "把 npmCommand 改为同名 .ps1、原生可执行文件，或 node 加实际 CLI 脚本；不会通过 cmd.exe 重解析参数。");
    binary = shim;
  }
  if (process.platform === "win32" && /\.ps1$/i.test(binary)) {
    env.PI_SYNC_CALL = JSON.stringify({ command: binary, arguments: args });
    try { binary = await executable("pwsh.exe", env); }
    catch { throw new SyncError("当前命令需要 PowerShell 7，但当前进程找不到 pwsh.exe。", "安装 PowerShell 7 并重新打开 Pi，或把 npmCommand 配置为 node 加实际 CLI 脚本。"); }
    nativeArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_CALL];
  }
  return new Promise<RunResult>((resolveResult, reject) => {
    const child = spawn(binary, nativeArgs, { cwd: options.cwd, env, shell: false, windowsHide: true,
      detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", stopped: string | undefined;
    const stdoutDecoder = new StringDecoder("utf8"), stderrDecoder = new StringDecoder("utf8");
    let outputBytes = 0;
    let killDone: Promise<void> | undefined;
    const stop = (reason: string) => {
      if (stopped) return;
      stopped = reason;
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn(join(env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killDone = new Promise<void>((done) => {
          killer.once("error", () => { child.kill(); stopped += "；无法调用进程树终止工具，请检查子进程"; done(); });
          killer.once("close", (code) => { if (code) { child.kill(); stopped += `；进程树终止工具退出码 ${code}`; } done(); });
        });
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      }
    };
    const onAbort = () => stop("操作已取消");
    const timer = setTimeout(() => stop(`命令超时（${options.timeout ?? 90_000} ms）`), options.timeout ?? 90_000);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    const collect = (kind: "stdout" | "stderr", chunk: Buffer) => {
      if (kind === "stdout") stdout += stdoutDecoder.write(chunk); else stderr += stderrDecoder.write(chunk);
      outputBytes += chunk.length;
      if (outputBytes > 80 * 1024 * 1024) stop("命令输出超过 80 MB 限制");
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.stdin.on("error", () => { /* a failed child may close stdin early */ });
    child.stdin.end(options.input);
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); };
    child.on("error", (error) => { cleanup(); reject(error); });
    child.on("close", async (code) => {
      cleanup();
      stdout += stdoutDecoder.end(); stderr += stderrDecoder.end();
      await killDone;
      if (stopped) reject(new SyncError(stopped, "已停止子进程；检查后续影响和回退状态，再决定是否重试。"));
      else resolveResult({ stdout, stderr, code: code ?? 1 });
    });
  });
};

export function relativePath(value: string) {
  if (!value || value.includes("\\") || value.startsWith("/") || value.includes(":")) throw new SyncError(`不是可移植的相对路径：${value}`, "使用 Agent Directory 内以正斜杠分隔的相对位置，不要提供盘符或绝对路径。");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new SyncError(`路径包含非法或跨平台不支持的部分：${value}`, "移除父级跳转、非法字符、保留文件名或末尾空格，再提供 agent 内的相对路径。");
  return value;
}

export async function safePath(root: string, relative: string) {
  relativePath(relative);
  const base = await realpath(root);
  const target = resolve(base, ...relative.split("/"));
  if (!target.startsWith(base + sep)) throw new SyncError("目标越出受管根。");
  let current = base;
  for (const part of relative.split("/")) {
    current = join(current, part);
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (stat?.isSymbolicLink()) throw new SyncError(`不跟随符号链接或 junction：${relative}`, "将需要同步的普通文件放在受管根内；外部链接不会自动打包。");
  }
  return target;
}

export async function exists(path: string) {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export async function readJson(path: string, fallback?: Record<string, unknown>) {
  let buffer: Buffer;
  try { buffer = await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && fallback) return fallback; throw error; }
  if (buffer.length > 4 * 1024 * 1024) throw new SyncError(`JSON 文件超过 4 MB：${path}`);
  const value = parseJsonBytes(buffer, path);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncError(`JSON 对象格式无效：${path}`, "修复对应 JSON 文件后重试；提示不会输出其正文。");
  return value as Record<string, unknown>;
}

export function parseJsonBytes(buffer: Uint8Array, label: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "")); }
  catch { throw new SyncError(`JSON 或 UTF-8 格式无效：${label}`, "修复对应 JSON 文件及编码后重试；提示不会输出正文。"); }
}

export async function atomicJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}
