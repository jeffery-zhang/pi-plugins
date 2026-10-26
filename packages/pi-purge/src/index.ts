import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const HOST_RULE = "Pi supplies the actual tools, working directory, project instructions and skills below. Use only declared tools; concrete engineering constraints in those sections take precedence over conflicting persona instructions.";

function digest(text: string | Uint8Array) {
  return createHash("sha256").update(text).digest("hex");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function texts(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    const item = record(part);
    return typeof item?.text === "string" ? item.text : "";
  }).filter(Boolean).join("\n");
}

function requestSummary(payload: unknown, body: string | undefined, ctx: ExtensionContext) {
  const data = record(payload);
  const messages = Array.isArray(data?.input) ? data.input : Array.isArray(data?.messages) ? data.messages : undefined;
  const instructions: Array<{ role: string; text: string }> = [];
  if (typeof data?.instructions === "string") instructions.push({ role: "instructions", text: data.instructions });
  if (data?.system !== undefined) instructions.push({ role: "system", text: texts(data.system) });
  const roles: string[] = [];
  for (const value of messages ?? []) {
    const message = record(value);
    const role = typeof message?.role === "string" ? message.role : typeof message?.type === "string" ? message.type : "unknown";
    roles.push(role);
    if (role === "system" || role === "developer") instructions.push({ role, text: texts(message?.content) });
  }
  const instructionText = instructions.map((item) => item.text).join("\n\n");
  const tools = Array.isArray(data?.tools) ? data.tools.flatMap((value) => {
    const tool = record(value);
    const name = tool?.name ?? record(tool?.function)?.name;
    return typeof name === "string" ? [name] : [];
  }) : [];
  const effort = record(data?.reasoning)?.effort ?? data?.reasoning_effort;
  return {
    api: ctx.model?.api ?? "unknown",
    provider: ctx.model?.provider ?? "unknown",
    model: ctx.model?.id ?? "unknown",
    instructionRoles: instructions.map((item) => item.role),
    instruction: instructionText ? { characters: instructionText.length, sha256: digest(instructionText) } : null,
    bodyPresent: body && (messages || data?.system !== undefined || typeof data?.instructions === "string") ? instructionText.includes(body) : null,
    messageOrder: messages ? roles : null,
    tools,
    reasoning: typeof effort === "string" && ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : null,
  };
}

interface PurgeOptions {
  sourceFile?: string;
  version?: string;
  report?: (message: string) => void;
}

export default function piPurge(pi: ExtensionAPI, options: PurgeOptions = {}) {
  const sourceFile = options.sourceFile ?? fileURLToPath(new URL("../prompts/default.md", import.meta.url));
  const report = options.report ?? ((message: string) => { process.stderr.write(`[pi-purge] ${message}\n`); });
  const compatible = (options.version ?? VERSION) === "1.4.0";
  let enabled = true;
  let active = false;
  let body: string | undefined;
  let source: { bytes: number; characters: number; sha256: string; adaptedCharacters: number; adaptedSha256: string } | undefined;
  let assembly: "not_run" | "prepared" | "applied" | "off" | "failed" = "not_run";
  let failure: string | undefined;
  let observed: ReturnType<typeof requestSummary> | undefined;

  function footer(ctx: ExtensionContext) {
    if (ctx.mode === "tui" && ctx.hasUI) {
      ctx.ui.setStatus("pi-purge", !compatible ? "purge: incompatible" : !enabled ? "purge: off" : `purge: ${assembly}`);
    }
  }

  function notify(ctx: ExtensionContext, message: string, error = false) {
    if (ctx.hasUI) ctx.ui.notify(message, error ? "error" : "info");
    else report(message);
    footer(ctx);
  }

  function clearRun() {
    body = undefined;
    active = false;
    observed = undefined;
  }

  function fail(ctx: ExtensionContext, reason: string) {
    clearRun();
    source = undefined;
    assembly = "failed";
    failure = reason;
    notify(ctx, `Pi Purge 未生效 (${reason})；本轮使用正常 Pi 提示。`, true);
  }

  async function load(ctx: ExtensionContext) {
    source = undefined;
    const bytes = await readFile(sourceFile, { signal: ctx.signal });
    const original = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let adapted = original.replace(/\r\n/g, "\n").trim();
    // Match DSH's envelope layout while retaining literal ChatML and the source file.
    adapted = adapted.replace(/<\|im_start\|>\s*system\s*:\s*/gi, "<|im_start|>system:\n");
    if (/<project_instructions>/i.test(adapted) && !/<\/project_instructions>/i.test(adapted)) adapted += "\n</project_instructions>";
    adapted = adapted.replace(/[ \t]+$/gm, "").trim();
    if (!adapted) throw new Error("empty_source");
    source = { bytes: bytes.length, characters: original.length, sha256: digest(bytes), adaptedCharacters: adapted.length, adaptedSha256: digest(adapted) };
    return adapted;
  }

  function errorCode(error: unknown) {
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    if (error instanceof Error && error.message === "empty_source") return "empty_source";
    if (error instanceof TypeError) return "invalid_utf8";
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return typeof code === "string" && /^[A-Z_]+$/.test(code) ? code : "source_unavailable";
  }

  pi.on("session_start", (_event, ctx) => {
    enabled = true;
    clearRun();
    source = undefined;
    assembly = "not_run";
    failure = undefined;
    if (!compatible) notify(ctx, "Pi Purge 未启用：当前仅验证并支持 Pi 1.4.0。", true);
    footer(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    clearRun();
    failure = undefined;
    assembly = "off";
    if (!compatible || !enabled) return;
    if (event.systemPromptOptions.forceSystemPrompt !== undefined) {
      fail(ctx, "opaque_system_override");
      return;
    }
    try {
      body = await load(ctx);
      active = true;
      assembly = "prepared";
      footer(ctx);
    } catch (error) {
      fail(ctx, errorCode(error));
    }
  });

  pi.on("context_with_system", (event, ctx) => {
    if (!active || !body) return;
    const head = event.messages[0];
    if (head?.role !== "system" || !head.sections || typeof head.sections.preamble !== "string" || texts(head.content)) {
      fail(ctx, "unstructured_system_prompt");
      return;
    }
    const preamble = `${body}\n\n<pi_host>\n${HOST_RULE}\n</pi_host>`;
    // Only transform the request projection; never mutate persisted transcript objects.
    const messages = event.messages.flatMap((message, index) => {
      if (message.role !== "system" || !message.sections || !("preamble" in message.sections)) return [message];
      const sections = { ...message.sections };
      if (index === 0) sections.preamble = preamble;
      else delete sections.preamble;
      if (index > 0 && !Object.keys(sections).length && !texts(message.content) && !message.toolsAdded?.length && !message.toolsRemoved?.length) return [];
      return [{ ...message, sections }];
    });
    assembly = "applied";
    footer(ctx);
    return { messages };
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!compatible || !active) return;
    observed = requestSummary(event.payload, body, ctx);
    if (observed.bodyPresent === false) notify(ctx, "Pi Purge 请求观察：未找到完整目标正文；请检查扩展顺序或 provider 转换。", true);
    if (!ctx.hasUI) report(JSON.stringify({ enabled, assembly, request: observed }));
    footer(ctx);
  });

  pi.on("agent_start", () => { active = body !== undefined; });
  pi.on("agent_end", () => { active = false; });
  function invalidateObservation(_event: unknown, ctx: ExtensionContext) {
    observed = undefined;
    assembly = !enabled ? "off" : body ? "prepared" : "not_run";
    footer(ctx);
  }
  pi.on("model_select", invalidateObservation);
  pi.on("session_compact", invalidateObservation);
  pi.on("session_tree", invalidateObservation);
  pi.on("session_shutdown", (_event, ctx) => {
    clearRun();
    source = undefined;
    if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.setStatus("pi-purge", undefined);
  });

  pi.registerCommand("purge", {
    description: "Pi Purge: on | off | status (defaults to status)",
    handler: async (args, ctx) => {
      const command = args.trim() || "status";
      if (!["on", "off", "status"].includes(command)) { notify(ctx, "用法：/purge on | off | status", true); return; }
      if (command !== "status") {
        if (!compatible) { notify(ctx, "Pi Purge 未启用：当前仅支持 Pi 1.4.0。", true); return; }
        if (!ctx.isIdle()) { notify(ctx, "请等待当前轮结束后再启停 Pi Purge。", true); return; }
        clearRun();
        failure = undefined;
        enabled = command === "on";
        assembly = enabled ? "not_run" : "off";
        if (enabled) {
          try { await load(ctx); }
          catch (error) { fail(ctx, errorCode(error)); return; }
        }
      }
      notify(ctx, JSON.stringify({ compatible, enabled, sourceFile, source: source ?? null, assembly, failure: failure ?? null, currentModel: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, api: ctx.model.api } : null, request: observed ?? null }, null, 2));
    },
  });
}
