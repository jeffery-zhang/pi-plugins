import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, VERSION, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { catalog, metadata, record, visible, type Entry, type RecordValue } from "./catalog.ts";
import { document, edit, mappings, providers, save, type Rename } from "./config.ts";
import { choose, confirm } from "./preview.ts";

interface Options { agentDir?: string; catalogUrl?: string; timeoutMs?: number; rename?: Rename }
const HELP = "/detect <provider>/<model> [来源名称或 provider/model]：更新一个已有模型\n/detect <provider>：更新显式配置的已有模型\n可输入 models.dev 的名称或 ID 指定来源；更新前统一预览并确认。";

async function source(entries: Entry[], target: string, saved: string | undefined, ctx: ExtensionCommandContext, signal: AbortSignal, explicit?: string): Promise<Entry | undefined> {
  const exact = explicit === undefined ? entries.find(entry => entry.key === (saved ?? target)) : undefined;
  if (exact) return exact;
  if (saved && explicit === undefined) ctx.ui.notify(`${visible(target)}：已保存来源失效，请重新指定。`, "warning");
  while (true) {
    const query = explicit ?? await ctx.ui.input(`${visible(target)}：输入 models.dev 来源名称或 provider/model（Esc 跳过）`, saved ?? target, { signal });
    explicit = undefined;
    signal.throwIfAborted();
    if (!query?.trim()) return undefined;
    const lookup = query.trim().toLowerCase();
    const full = entries.find(entry => entry.key === query.trim());
    if (full) return full;
    const exactNames = entries.filter(entry => entry.id.toLowerCase() === lookup || entry.name.toLowerCase() === lookup);
    const candidates = exactNames.length ? exactNames : entries.filter(entry => entry.key.toLowerCase().includes(lookup) || entry.name.toLowerCase().includes(lookup));
    if (!candidates.length || candidates.length > 100) {
      ctx.ui.notify(candidates.length ? "候选超过 100 个，请输入更完整的来源名称或 ID。" : "没有匹配的聊天模型，请重新输入或按 Esc 跳过。", "warning");
      continue;
    }
    const labels = candidates.map(entry => `${entry.key} — ${entry.name}`);
    const selected = await choose(ctx, labels, signal);
    signal.throwIfAborted();
    return selected === undefined ? undefined : candidates[labels.indexOf(selected)];
  }
}

export default function modelDetect(pi: ExtensionAPI, options: Options = {}) {
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let shuttingDown = false;
  pi.registerCommand("detect", {
    description: "从 models.dev 补全已有模型参数（预览、备份，重启生效）",
    handler: async (input, ctx) => {
      if (!ctx.hasUI || ctx.mode === "print" || ctx.mode === "json") throw new Error("/detect 需要交互 UI 预览并确认；本次未修改配置。");
      if (!input.trim()) { ctx.ui.notify(HELP, "info"); return; }
      if (!/^([1-9]\d*)\./.test(VERSION) || Number(VERSION.split(".")[0]) < 1 || (Number(VERSION.split(".")[0]) === 1 && Number(VERSION.split(".")[1]) < 4)) throw new Error("/detect 需要 Pi 1.4 或更高版本。");
      if (pending) throw new Error("已有 /detect 操作正在运行，请先完成或取消。");
      if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error("请在模型空闲且没有排队消息时执行 /detect。");
      controller = new AbortController();
      const signal = controller.signal;
      const run = async () => {
        const root = options.agentDir ?? getAgentDir();
        const lockPath = join(root, "model-detect.lock");
        let locked = false;
        try {
          try { const handle = await open(lockPath, "wx", 0o600); locked = true; await handle.close(); }
          catch { throw new Error("无法获取 /detect 配置锁；请检查其他 Pi 操作、目录权限或遗留的 model-detect.lock。"); }
          const models = await document(join(root, "models.json"), { providers: {} });
          const state = await document(join(root, "model-detect.json"), { sources: {} });
          const configured = providers(models);
          const saved = mappings(state);
          const [argument, explicitSource] = input.trim().split(/\s+(.*)/s);
          const separator = argument.indexOf("/");
          const provider = separator < 0 ? argument : argument.slice(0, separator);
          const requested = separator < 0 ? undefined : argument.slice(separator + 1);
          if (!provider || requested === "" || /\s/.test(provider)) throw new Error(HELP);
          if (requested === undefined && explicitSource) throw new Error("/detect：批量更新按目标逐一映射；指定来源时请同时指定目标模型。");
          const providerConfig = Object.hasOwn(configured, provider) && record(configured[provider]) ? configured[provider] : {};
          const declarations = Array.isArray(providerConfig.models) ? providerConfig.models as RecordValue[] : [];
          const overrides = record(providerConfig.modelOverrides) ? providerConfig.modelOverrides : {};
          const ids = requested !== undefined ? [requested] : [...new Set([...declarations.map(model => String(model.id)), ...Object.keys(overrides)])];
          const targets = ids.map(id => ({ id, model: ctx.modelRegistry.find(provider, id) })).filter(item => item.model !== undefined);
          if (requested !== undefined && !targets.length) throw new Error("Pi 未识别该目标模型；本命令不会创建新模型。");
          if (!targets.length) { ctx.ui.notify("该 provider 没有显式配置的已有模型；未导入目录模型。", "info"); return; }
          ctx.ui.notify("正在查询 models.dev…（TUI 中可按 Esc 取消）", "info");
          const offInput = ctx.mode === "tui" ? ctx.ui.onTerminalInput(data => {
            if (data === "\x1b" || data === "\x03") { controller?.abort(); return { consume: true }; }
            return undefined;
          }) : undefined;
          let entries: Entry[];
          try { entries = await catalog(options.catalogUrl ?? "https://models.dev/api.json?type=chat", AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 30_000)])); }
          finally { offInput?.(); }
          signal.throwIfAborted();
          let modelText = models.text, stateText = state.text;
          const summary: string[] = ids.filter(id => !targets.some(target => target.id === id)).map(id => `${visible(provider + "/" + id)}：跳过（Pi 未识别的覆盖目标）`);
          let updated = 0, skipped = ids.length - targets.length, same = 0, changedMapping = 0;
          for (const { id, model } of targets) {
            const key = `${provider}/${id}`;
            const entry = await source(entries, key, saved.get(key), ctx, signal, explicitSource);
            if (!entry) { skipped++; summary.push(`${visible(key)}：跳过（未选择来源）`); continue; }
            const declared = declarations.find(item => item.id === id) ?? {};
            const existing = record(overrides[id]) ? overrides[id] : {};
            const current: RecordValue = { ...model, ...declared, ...existing };
            for (const field of ["cost", "thinkingLevelMap"] as const) current[field] = { ...model![field], ...(record(declared[field]) ? declared[field] : {}), ...(record(existing[field]) ? existing[field] : {}) };
            const { patch, warnings } = metadata(entry, current);
            const changes: string[] = [];
            for (const [field, value] of Object.entries(patch)) {
              const fields: [string | undefined, unknown][] = record(value) ? Object.entries(value) : [[undefined, value]];
              for (const [child, next] of fields) {
                const path = ["providers", provider, "modelOverrides", id, field, ...(child === undefined ? [] : [child])];
                modelText = edit(modelText, path, next);
                const before = child === undefined ? current[field] : record(current[field]) ? current[field][child] : undefined;
                changes.push(`${field}${child === undefined ? "" : "." + child}: ${JSON.stringify(before) ?? "未知"} → ${JSON.stringify(next)}`);
              }
            }
            if (saved.get(key) !== entry.key) {
              stateText = edit(stateText, ["sources", key], entry.key);
              changedMapping++;
              changes.push(`来源映射: ${saved.get(key) ?? "未保存"} → ${entry.key}`);
            }
            if (Object.keys(patch).length) updated++; else same++;
            summary.push(`${visible(key)} ← ${entry.key}\n${changes.length ? changes.join("\n") : "参数未变化"}${warnings.length ? "\n保留/跳过：" + warnings.join("；") : ""}`);
          }
          const counts = `参数更新 ${updated}，参数未变化 ${same}，目标跳过 ${skipped}，来源映射更新 ${changedMapping}`;
          const preview = summary.join("\n\n").split("\n").map(visible).join("\n") + `\n\n${counts}\n价格按选定目录条目（USD/百万 tokens）估算；原厂价可能与代理账单不同。\n保存后请重启 Pi 生效。`;
          if (!updated && !changedMapping) { ctx.ui.notify(preview, "info"); return; }
          const accepted = await confirm(ctx, preview, signal);
          signal.throwIfAborted();
          if (!accepted) { ctx.ui.notify("已取消；模型配置与来源映射均未修改。", "info"); return; }
          const backup = await save(root, [{ doc: models, text: modelText }, { doc: state, text: stateText }], signal, options.rename);
          if (!shuttingDown) ctx.ui.notify(`${counts}\n备份：${backup}\n请重启 Pi 生效；当前会话继续使用原模型参数。`, "info");
        } catch (error) {
          if (signal.aborted && error instanceof Error && error.name === "AbortError") { if (!shuttingDown) ctx.ui.notify("操作已取消；未发布配置更改。", "info"); return; }
          if (error instanceof Error && error.name === "TimeoutError") throw new Error("models.dev 请求超时；配置未修改。");
          // Only our fixed validation errors are shown; filesystem/network errors may contain credentials.
          if (error instanceof Error && /^(目录|配置|模型配置|来源映射|无法|保存失败|Pi 未识别|\/detect)/.test(error.message)) throw error;
          throw new Error("/detect 失败；未发布配置更改，请检查目录连接或文件权限。");
        } finally {
          if (locked) await rm(lockPath, { force: true }).catch(() => {
            if (!shuttingDown) ctx.ui.notify("无法清理 model-detect.lock；请确认操作结束后检查并移除遗留锁。", "warning");
          });
        }
      };
      pending = run();
      try { await pending; } finally { pending = undefined; controller = undefined; }
    },
  });
  pi.on("session_shutdown", async () => { shuttingDown = true; controller?.abort(); await pending?.catch(() => {}); });
}
