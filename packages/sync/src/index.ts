import { getAgentDir, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { explain, redact, SyncError } from "./io.ts";
import { Sync, type SyncOptions } from "./sync.ts";

interface Options extends Partial<SyncOptions> { report?: (message: string) => void }
const HELP = "Pi Sync（Pi 1.4.x）\n/sync setup <仓库地址> [分支]\n/sync save\n/sync restore\n/sync status\n/sync include <agent 内相对路径>\n/sync exclude <相对路径>\n/sync recover\n/sync cancel\n带空格的参数用引号包裹；保存以本机为准，还原以远端为准，先备份后强制应用。";

function argumentsOf(input: string) {
  const result: string[] = [];
  let value = "", quote = "", started = false;
  for (const char of input.trim()) {
    if (quote) { if (char === quote) quote = ""; else value += char; started = true; }
    else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { result.push(value); value = ""; started = false; } }
    else { value += char; started = true; }
  }
  if (quote) throw new SyncError("命令参数的引号未闭合。", "用完整的单引号或双引号包裹带空格参数。");
  if (started) result.push(value);
  return result;
}

export default function piSync(pi: ExtensionAPI, options: Options = {}) {
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  let shuttingDown = false;
  pi.registerCommand("sync", {
    description: "保存或还原 Pi 可移植环境（不托管鉴权）",
    handler: async (input, ctx) => {
      const report = (text: string, level: "info" | "error" = "info") => {
        if (options.report) options.report(text);
        else if (ctx.hasUI && !shuttingDown) { if (level !== "error" || ctx.mode !== "tui") ctx.ui.notify(text, level); }
        else process.stderr.write(`[pi-sync] ${text}\n`);
      };
      const invalid = (error: unknown): never => {
        const detail = explain(error);
        const message = redact(`Pi Sync 失败，阶段：命令检查\n原因：${detail.reason}\n影响：本次操作未启动，本机与远端未修改。\n备份：本次尚未生成；既有备份未修改。\n处理：${detail.hint}`);
        report(message, "error"); throw new SyncError(message);
      };
      let args: string[] = [];
      try { args = argumentsOf(input); } catch (error) { invalid(error); }
      const [action = "help", ...values] = args;
      if (action === "help") { report(HELP); return; }
      if (action === "cancel") { controller?.abort(); report(controller ? "已请求取消；等待当前操作停止并报告回退状态。" : "没有正在运行的操作。"); return; }
      if (pending) invalid(new SyncError("本会话已有同步操作正在运行。", "等待完成或运行 /sync cancel。"));
      const count: Record<string, [number, number]> = { setup: [1, 2], save: [0, 0], restore: [0, 0], status: [0, 0], include: [1, 1], exclude: [1, 1], recover: [0, 0] };
      const expected = count[action];
      if (!expected || values.length < expected[0] || values.length > expected[1]) {
        const error = new SyncError("未知动作或参数数量不正确。", HELP);
        invalid(error);
      }
      if (!ctx.isIdle() || ctx.hasPendingMessages()) invalid(new SyncError("请在模型空闲且没有排队消息时执行同步。", "等待当前任务和排队消息结束后重试。"));
      controller = new AbortController();
      const operation = new Sync({ agentDir: options.agentDir ?? getAgentDir(), version: options.version ?? VERSION,
        run: options.run, rename: options.rename, git: options.git, pi: options.pi }, controller.signal);
      const task = async () => {
        try {
          const result = await operation.locked(async () => {
            switch (action) {
              case "setup": return operation.setup(values[0], values[1], ctx.cwd);
              case "save": return operation.save();
              case "restore": return operation.restore();
              case "status": return operation.status();
              case "include": return operation.select(values[0], true);
              case "exclude": return operation.select(values[0], false);
              case "recover": return operation.recover();
              default: throw new SyncError("未知动作。");
            }
          }, action === "recover" || action === "status", action !== "recover");
          const warnings = [...new Set(operation.warnings)];
          report(redact(`${result}${warnings.length ? `\n提示：${warnings.slice(0, 30).join("\n")}${warnings.length > 30 ? "\n其余同类提示已省略。" : ""}` : ""}`, operation.secrets));
        } catch (error) {
          const message = operation.error(error, action);
          report(message, "error");
          throw new SyncError(message);
        }
      };
      pending = task();
      try { await pending; } finally { controller = undefined; pending = undefined; }
    },
  });
  pi.on("session_shutdown", async () => { shuttingDown = true; controller?.abort(); await pending?.catch(() => undefined); });
}
