import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const TARGET_PROVIDER = "muryo";
export const TARGET_MODEL = "gemini-4-hydrogen-sonar";
export const REPLACEMENT_PROMPT = [
  "You are a coding assistant. Follow the user's task and the applicable project instructions.",
  "Use the available tools to inspect files, run commands, and modify code when helpful.",
  "Keep changes focused, verify the result when practical, and respond concisely with relevant file paths.",
  "When asked about the coding environment or its extensions, consult the relevant documentation and examples.",
].join(" ");

export function isTargetModel(ctx: Pick<ExtensionContext, "model">): boolean {
  return ctx.model?.provider === TARGET_PROVIDER && ctx.model.id === TARGET_MODEL;
}

export function shouldReplacePrompt(options: {
  customPrompt?: string;
  forceSystemPrompt?: string;
}): boolean {
  return options.customPrompt === undefined && options.forceSystemPrompt === undefined;
}

export function createPromptReplaceExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, ctx) => {
    if (!isTargetModel(ctx)) return;
    if (!shouldReplacePrompt(event.systemPromptOptions)) return;
    event.systemPromptOptions.customPrompt = REPLACEMENT_PROMPT;
  });
}

export default function promptReplace(pi: ExtensionAPI): void {
  createPromptReplaceExtension(pi);
}
