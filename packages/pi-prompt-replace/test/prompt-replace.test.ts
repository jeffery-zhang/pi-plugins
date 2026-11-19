import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  REPLACEMENT_PROMPT,
  TARGET_MODEL,
  TARGET_PROVIDER,
  createPromptReplaceExtension,
  isTargetModel,
  shouldReplacePrompt,
} from "../src/index.ts";

type Handler = (event: any, ctx: ExtensionContext) => void;

function harness(model: { provider: string; id: string } | null = {
  provider: TARGET_PROVIDER,
  id: TARGET_MODEL,
}) {
  let handler: Handler | undefined;
  const pi = {
    on: (name: string, callback: Handler) => {
      assert.equal(name, "before_agent_start");
      handler = callback;
    },
  } as unknown as ExtensionAPI;
  createPromptReplaceExtension(pi);
  assert.ok(handler);
  const ctx = { model: model ?? undefined } as unknown as ExtensionContext;
  return { handler, ctx };
}

function event(options: Record<string, unknown> = {}) {
  return { systemPromptOptions: { ...options } };
}

test("replaces only the target model's default prompt", () => {
  const h = harness();
  const input = event();
  h.handler!(input, h.ctx);
  assert.equal(input.systemPromptOptions.customPrompt, REPLACEMENT_PROMPT);

  const other = harness({ provider: "openai", id: TARGET_MODEL });
  const otherInput = event();
  other.handler!(otherInput, other.ctx);
  assert.deepEqual(otherInput.systemPromptOptions, {});
});

test("preserves explicit and forced system prompts", () => {
  const h = harness();
  const explicit = event({ customPrompt: "USER_PROMPT" });
  h.handler!(explicit, h.ctx);
  assert.equal(explicit.systemPromptOptions.customPrompt, "USER_PROMPT");

  const forced = event({ forceSystemPrompt: "FORCED_PROMPT" });
  h.handler!(forced, h.ctx);
  assert.deepEqual(forced.systemPromptOptions, { forceSystemPrompt: "FORCED_PROMPT" });
});

test("does not replace without a selected model", () => {
  const h = harness(null);
  const input = event();
  h.handler!(input, h.ctx);
  assert.deepEqual(input.systemPromptOptions, {});
});

test("helpers keep the model and override rules explicit", () => {
  assert.equal(isTargetModel({ model: { provider: TARGET_PROVIDER, id: TARGET_MODEL } } as any), true);
  assert.equal(isTargetModel({ model: { provider: TARGET_PROVIDER, id: "other" } } as any), false);
  assert.equal(shouldReplacePrompt({}), true);
  assert.equal(shouldReplacePrompt({ customPrompt: "" }), false);
  assert.equal(shouldReplacePrompt({ forceSystemPrompt: "forced" }), false);
});
