import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename } from "node:path";
import { abort, exists, parseJsonBytes, readJson, relativePath, safePath, SyncError } from "./io.ts";

export const DEFAULT_ROOTS = ["extensions", "agents", "skills", "prompts", "themes", "AGENTS.override.md", "AGENTS.md", "CLAUDE.md", "SYSTEM.md", "APPEND_SYSTEM.md"];
export const CONFIG_FILES = ["settings.json", "models.json", "mcp.json", "keybindings.json"] as const;
export const SETTING_KEYS = new Set([
  "defaultProvider", "defaultModel", "defaultThinkingLevel", "modelThinkingLevels", "thinkingBudgets", "enabledModels",
  "hideThinkingBlock", "showCacheMissNotices", "cacheWarming", "steeringMode", "followUpMode", "doubleEscapeAction", "treeFilterMode",
  "defaultTools", "codemode", "compaction", "branchSummary", "theme", "quietStartup", "tuiMode", "fullscreenExitOutput",
  "fullscreenScrollbar", "fullscreenCopyOnSelect", "fullscreenWheelScrollLines", "editorPaddingX", "outputPad", "autocompleteMaxVisible",
  "showHardwareCursor", "images", "markdown", "retry", "enableSkillCommands", "collapseChangelog", "warnings", "terminal", "transport",
  "packages", "extensions", "skills", "prompts", "themes",
]);
const RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"];
const CREDENTIAL_FILES = /^(?:auth\.json|mcp-auth\.json|trust\.json|\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\.json)?)$/i;
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".svn", ".hg", ".cache"]);
const FORBIDDEN_ROOTS = new Set(["sync", "npm", "git", "bin", "fff", "sessions", "tools", "tmp", "extensions-temp"]);
const SECRET_KEYS = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer[_-]?token|auth[_-]?token|token|client[_-]?secret|secret|password|private[_-]?key|authorization|proxy-authorization|x-api-key|api-key|x-auth-token|x-access-token|x-api-token|cookie|set-cookie)$/i;
const REF = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/;
const DB_KEYS = new Set(["frecencyDbPath", "historyDbPath"]);
const NAMED_ENTRIES = new Set(["providers", "mcpServers", "modelOverrides", "dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "scripts", "bin"]);
export interface Resource { path: string; content: string; sha256: string; executable: boolean }
export interface Snapshot {
  format: 1;
  piVersion: string;
  createdAt: string;
  settings: Record<string, unknown>;
  models: Record<string, unknown> | null;
  mcp: Record<string, unknown> | null;
  keybindings: Record<string, unknown> | null;
  roots: string[];
  files: Resource[];
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function hash(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
export function compatible(version: string) { return /^1\.4\.\d+$/.test(version); }

export function credentialFile(path: string) { return CREDENTIAL_FILES.test(basename(path)); }

export function validateRoot(path: string) {
  relativePath(path);
  if (FORBIDDEN_ROOTS.has(path.split("/")[0].toLowerCase()) || credentialFile(path)
    || CONFIG_FILES.some((name) => name.toLowerCase() === path.toLowerCase()) || path.toLowerCase() === "models-store.json") {
    throw new SyncError(`此内容不能作为用户资源纳入：${path}`, "凭据、原生配置、安装产物、缓存和 Pi Sync 自身工作内容有独立的处理规则。");
  }
  if (path.split("/").some((part) => SKIP_DIRECTORIES.has(part.toLowerCase()))) throw new SyncError(`安装或版本管理目录不能纳入：${path}`);
  return path;
}

export function normalizeRoots(roots: string[]) {
  const sorted = [...new Set(roots.map(validateRoot))].sort();
  const folded = new Set<string>();
  const result: string[] = [];
  for (const root of sorted) {
    const lower = root.toLowerCase();
    if (folded.has(lower)) throw new SyncError(`受管资源存在大小写冲突：${root}`);
    folded.add(lower);
    if (!result.some((parent) => lower.startsWith(parent.toLowerCase() + "/"))) result.push(root);
  }
  return result;
}

function safeUrl(value: string, secrets: string[], warnings: string[]) {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    let changed = false;
    if (url.username || url.password) { if (url.password) secrets.push(decodeURIComponent(url.password)); url.username = ""; url.password = ""; changed = true; }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEYS.test(key)) { const secret = url.searchParams.get(key); if (secret) secrets.push(secret); url.searchParams.delete(key); changed = true; }
    }
    if (changed) { warnings.push("已过滤 URL 中已知的内嵌鉴权。"); return url.toString(); }
  } catch { /* environment-based URLs are retained as definitions */ }
  return value;
}

export function cleanKnown(value: unknown, secrets: string[], warnings: string[], key = ""): unknown {
  if (SECRET_KEYS.test(key)) {
    if (typeof value === "string" && REF.test(value)) return value;
    if (value !== undefined) secrets.push(typeof value === "string" ? value : JSON.stringify(value));
    warnings.push(`已过滤鉴权字段 ${key}，由目标机器自行设置。`);
    return undefined;
  }
  if (typeof value === "string") {
    return /^(url|baseUrl)$/i.test(key) ? safeUrl(value, secrets, warnings) : value;
  }
  if (Array.isArray(value)) return value.map((item) => cleanKnown(item, secrets, warnings));
  if (!object(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(name)) throw new SyncError("JSON 包含不支持的原型属性。");
    if (!NAMED_ENTRIES.has(key) && name === "env" && object(item)) {
      result[name] = Object.fromEntries(Object.entries(item).filter(([envName, envValue]) => {
        if (typeof envValue === "string" && REF.test(envValue)) return true;
        if (typeof envValue === "string" && envValue) secrets.push(envValue);
        warnings.push(`已过滤环境变量值 ${envName}，由目标机器自行设置。`);
        return false;
      }));
      continue;
    }
    const cleaned = cleanKnown(item, secrets, warnings, NAMED_ENTRIES.has(key) ? "" : name);
    if (cleaned !== undefined) result[name] = cleaned;
  }
  return result;
}

export function preserveAuth(incoming: unknown, local: unknown, key = ""): unknown {
  if (SECRET_KEYS.test(key) && local !== undefined) return local;
  if (key === "env" && object(incoming) && object(local)) return { ...incoming, ...local };
  if (Array.isArray(incoming)) {
    const previous = Array.isArray(local) ? local : [];
    return incoming.map((item) => object(item) && typeof item.id === "string"
      ? preserveAuth(item, previous.find((old) => object(old) && old.id === item.id)) : item);
  }
  if (!object(incoming)) return incoming;
  const previous = object(local) ? local : {};
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(incoming)) result[name] = preserveAuth(value, previous[name], NAMED_ENTRIES.has(key) ? "" : name);
  for (const [name, value] of Object.entries(previous)) if (!NAMED_ENTRIES.has(key) && (SECRET_KEYS.test(name) || name === "env") && !(name in result)) result[name] = value;
  return result;
}

export function portableSettings(settings: Record<string, unknown>, warnings: string[]) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTING_KEYS.has(key)) {
      if (!["$schema", "lastChangelogVersion", "trackingId", "externalEditor", "shellPath", "shellCommandPrefix", "npmCommand", "httpProxy", "sessionDir", "sessionShareDestination", "defaultProjectTrust", "enableAnalytics", "enableInstallTelemetry"].includes(key)) warnings.push(`未纳入同步的设置字段 ${key}，目标机器按本机设置保留。`);
      continue;
    }
    if (RESOURCE_KEYS.includes(key)) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new SyncError(`设置 ${key} 必须是字符串数组。`);
      result[key] = value.filter((entry: string) => {
        const path = entry.replace(/^[!+-]/, "");
        if (path.startsWith("builtin:")) return true;
        if (path.startsWith("~") || /^([A-Za-z]:|[\\/])/.test(path) || path.split(/[\\/]/).includes("..")) {
          warnings.push(`未覆盖目录外的 ${key} 引用。`); return false;
        }
        return true;
      });
    } else if (key === "terminal" && object(value)) {
      result[key] = Object.fromEntries(Object.entries(value).filter(([name]) => ["showImages", "imageWidthCells", "clearOnShrink", "showTerminalProgress"].includes(name)));
    } else result[key] = value;
  }
  return result;
}

export function restoreSettings(incoming: Record<string, unknown>, local: Record<string, unknown>) {
  const result = { ...Object.fromEntries(Object.entries(local).filter(([key]) => !SETTING_KEYS.has(key))), ...incoming };
  if (object(local.terminal)) result.terminal = { ...Object.fromEntries(Object.entries(local.terminal).filter(([name]) => !["showImages", "imageWidthCells", "clearOnShrink", "showTerminalProgress"].includes(name))), ...(object(incoming.terminal) ? incoming.terminal : {}) };
  return result;
}

export async function defaultRoots(agentDir: string) {
  const names = await readdir(agentDir);
  return DEFAULT_ROOTS.map((canonical) => {
    const actual = names.filter((name) => name.toLowerCase() === canonical.toLowerCase());
    if (actual.length > 1) throw new SyncError(`目录内存在跨平台大小写冲突：${canonical}`);
    return actual[0] ?? canonical;
  });
}

export async function collectResources(agentDir: string, roots: string[], signal: AbortSignal, secrets: string[], warnings: string[]) {
  const files: Resource[] = [];
  const folded = new Set<string>();
  let total = 0;
  const walk = async (relative: string) => {
    abort(signal);
    if (credentialFile(relative) || relative.split("/").some((part) => SKIP_DIRECTORIES.has(part.toLowerCase()))) return;
    const absolute = await safePath(agentDir, relative);
    if (!await exists(absolute)) return;
    const stat = await lstat(absolute);
    if (stat.isDirectory()) {
      for (const entry of (await readdir(absolute)).sort()) await walk(`${relative}/${entry}`);
      return;
    }
    if (!stat.isFile()) throw new SyncError(`不是普通资源文件：${relative}`);
    if (stat.size > 8 * 1024 * 1024) throw new SyncError(`单个资源超过 8 MB：${relative}`);
    let content = await readFile(absolute);
    if (/\.json$/i.test(relative)) {
      const json = parseJsonBytes(content, relative);
      const cleaned = cleanKnown(json, secrets, warnings);
      if (relative === "pi-fff.json" && object(cleaned)) for (const key of DB_KEYS) delete cleaned[key];
      content = Buffer.from(JSON.stringify(cleaned, null, 2) + "\n");
    }
    total += content.length;
    if (total > 40 * 1024 * 1024 || files.length >= 10_000) throw new SyncError("用户资源超过 40 MB 或 10000 个文件限制。", "缩小选定范围；不要纳入依赖树或生成产物。");
    if (folded.has(relative.toLowerCase())) throw new SyncError(`资源存在跨平台大小写冲突：${relative}`);
    folded.add(relative.toLowerCase());
    files.push({ path: relative, content: content.toString("base64"), sha256: hash(content), executable: (stat.mode & 0o111) !== 0 });
  };
  for (const root of normalizeRoots(roots)) await walk(root);
  return files;
}

export async function readOptional(agentDir: string, name: typeof CONFIG_FILES[number]) {
  const path = await safePath(agentDir, name);
  return await exists(path) ? readJson(path) : null;
}

function validateJson(value: unknown, depth = 0) {
  if (depth > 64) throw new SyncError("快照 JSON 嵌套超过 64 层。");
  if (Array.isArray(value)) for (const item of value) validateJson(item, depth + 1);
  else if (object(value)) for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new SyncError("快照包含非法原型属性。");
    validateJson(item, depth + 1);
  }
}

export function validateSnapshot(value: unknown): Snapshot {
  validateJson(value);
  if (!object(value) || value.format !== 1 || typeof value.piVersion !== "string" || !compatible(value.piVersion)
    || typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)) || !object(value.settings)
    || ![value.models, value.mcp, value.keybindings].every((item) => item === null || object(item))
    || !Array.isArray(value.roots) || value.roots.some((root) => typeof root !== "string") || !Array.isArray(value.files)) {
    throw new SyncError("快照格式、必需字段或创建时的 Pi 版本不支持。", "使用支持 Pi 1.4.x 的 Pi Sync 重新保存完整快照；原环境不会部分应用。");
  }
  const roots = normalizeRoots(value.roots as string[]);
  if (JSON.stringify(roots) !== JSON.stringify(value.roots)) throw new SyncError("快照资源根重复、重叠或未规范化。");
  if (Object.keys(value.settings).some((key) => !SETTING_KEYS.has(key))) throw new SyncError("快照包含不支持的本机设置字段。");
  if (JSON.stringify(portableSettings(value.settings, [])) !== JSON.stringify(value.settings)) throw new SyncError("快照包含未覆盖的目录外资源引用或本机终端能力设置。");
  for (const key of ["defaultProvider", "defaultModel", "theme"]) if (value.settings[key] !== undefined && typeof value.settings[key] !== "string") throw new SyncError(`快照设置 ${key} 必须是字符串。`);
  for (const key of ["enabledModels", "defaultTools"]) if (value.settings[key] !== undefined && (!Array.isArray(value.settings[key]) || (value.settings[key] as unknown[]).some((item) => typeof item !== "string"))) throw new SyncError(`快照设置 ${key} 必须是字符串数组。`);
  if (object(value.models) && value.models.providers !== undefined) {
    if (!object(value.models.providers)) throw new SyncError("快照 providers 必须是对象。");
    for (const provider of Object.values(value.models.providers)) {
      if (!object(provider) || (provider.models !== undefined && (!Array.isArray(provider.models) || provider.models.some((model) => !object(model) || typeof model.id !== "string" || !model.id)))) throw new SyncError("快照供应商或模型身份无效。");
    }
  }
  const paths = new Set<string>();
  let total = 0;
  if (value.files.length > 10_000) throw new SyncError("快照资源数量超过限制。");
  for (const file of value.files) {
    if (!object(file) || typeof file.path !== "string" || typeof file.content !== "string" || typeof file.sha256 !== "string" || typeof file.executable !== "boolean") throw new SyncError("快照资源记录不完整。");
    relativePath(file.path);
    if (!roots.some((root) => file.path === root || (file.path as string).startsWith(root + "/")) || credentialFile(file.path)
      || file.path.split("/").some((part) => SKIP_DIRECTORIES.has(part.toLowerCase()))) throw new SyncError(`资源不在允许的受管范围：${file.path}`);
    const bytes = Buffer.from(file.content, "base64");
    total += bytes.length;
    if (bytes.toString("base64") !== file.content || bytes.length > 8 * 1024 * 1024 || total > 40 * 1024 * 1024 || hash(bytes) !== file.sha256) throw new SyncError(`资源完整性校验失败：${file.path}`);
    const foldedPath = file.path.toLowerCase();
    if (paths.has(foldedPath)) throw new SyncError(`快照资源存在大小写或重复冲突：${file.path}`);
    if ([...paths].some((path) => path.startsWith(foldedPath + "/") || foldedPath.startsWith(path + "/"))) throw new SyncError("资源文件与目录发生冲突。");
    paths.add(foldedPath);
  }
  const packages = value.settings.packages;
  if (packages !== undefined && (!Array.isArray(packages) || packages.some((entry) => !(typeof entry === "string" || (object(entry) && typeof entry.source === "string"))))) throw new SyncError("快照 packages 声明无效。");
  for (const entry of Array.isArray(packages) ? packages : []) {
    const source = typeof entry === "string" ? entry : entry.source;
    if (source.startsWith("./")) {
      const path = validateRoot(source.slice(2));
      if (!value.files.some((file: Resource) => file.path === path || file.path.startsWith(path + "/"))) throw new SyncError("快照本地扩展没有对应的源码资源。");
    }
  }
  return value as unknown as Snapshot;
}
