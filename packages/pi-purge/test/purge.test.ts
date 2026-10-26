import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piPurge from "../src/index.ts";

type Handler = (event: any, ctx: ExtensionContext) => any;
const PRIVATE = "PRIVATE_FIXTURE_DO_NOT_LOG";

function harness(t: test.TestContext, text = `${PRIVATE}\nRole instructions.`, version = "1.4.0", mode = "tui", useBundledPrompt = false) {
  const directory = mkdtempSync(join(tmpdir(), "pi-purge-test-"));
  const sourceFile = join(directory, "prompt.md");
  writeFileSync(sourceFile, text, "utf8");
  t.after(() => {
    assert.ok(directory.startsWith(join(tmpdir(), "pi-purge-test-")));
    rmSync(directory, { recursive: true, force: true });
  });
  const handlers = new Map<string, Handler>();
  let command: (args: string, ctx: ExtensionContext) => Promise<void>;
  const reports: string[] = [];
  const notifications: string[] = [];
  const statuses: Array<string | undefined> = [];
  const ctx = {
    mode, hasUI: mode === "tui" || mode === "rpc", cwd: directory, signal: undefined,
    model: { id: "deepseek-v4.1-flash", provider: "muryo", api: "openai-responses" },
    isIdle: () => true,
    ui: {
      notify: (message: string) => { assert.ok(ctx.hasUI); notifications.push(message); },
      setStatus: (_key: string, message?: string) => { assert.equal(ctx.mode, "tui"); statuses.push(message); },
    },
  } as unknown as ExtensionContext;
  const pi = {
    on: (name: string, handler: Handler) => { handlers.set(name, handler); },
    registerCommand: (name: string, definition: { handler: typeof command }) => { assert.equal(name, "purge"); command = definition.handler; },
  } as unknown as ExtensionAPI;
  piPurge(pi, { sourceFile: useBundledPrompt ? undefined : sourceFile, version, report: (message) => reports.push(message) });
  const event = (name: string, payload: any = {}) => handlers.get(name)!(payload, ctx);
  const run = () => event("before_agent_start", { systemPromptOptions: {} });
  const status = async () => {
    await command!("status", ctx);
    return JSON.parse((ctx.hasUI ? notifications : reports).at(-1)!);
  };
  return { ctx, sourceFile, event, run, command: (args: string) => command!(args, ctx), status, reports, notifications, statuses };
}

function transcript() {
  return [
    { role: "system", content: "", sections: {
      preamble: "HOST_IDENTITY",
      tools: "<tools>read write edit</tools>",
      rules: "<rules>ENGINEERING_CONSTRAINT</rules>",
      project_context: "<project_context>AGENTS_RULE</project_context>",
      skills: "<skills>SKILL_INFO</skills>",
      cwd: "<cwd>D:/fixture</cwd>",
    }, toolsAdded: [{ name: "read", parameters: { type: "object" } }], timestamp: 1 },
    { role: "user", content: "USER_PRIVATE_FIXTURE", timestamp: 2 },
  ];
}

function instruction(messages: ReturnType<typeof transcript>): string {
  return Object.values(messages[0]!.sections!).join("\n\n");
}

test("request projection replaces identity while retaining engineering sections, tools and history", async (t) => {
  const h = harness(t);
  await h.event("session_start");
  await h.run();
  const original = transcript();
  const snapshot = structuredClone(original);
  const result = await h.event("context_with_system", { messages: original });
  assert.ok(result.messages[0].sections.preamble.startsWith(PRIVATE));
  assert.ok(result.messages[0].sections.preamble.includes("concrete engineering constraints"));
  assert.ok(!instruction(result.messages).includes("HOST_IDENTITY"));
  for (const name of ["tools", "rules", "project_context", "skills", "cwd"]) assert.equal(result.messages[0].sections[name], (original[0]!.sections as any)[name]);
  assert.deepEqual(result.messages[0].toolsAdded, original[0]!.toolsAdded);
  assert.equal(result.messages[1], original[1]);
  assert.deepEqual(original, snapshot);
  assert.equal((await h.status()).assembly, "applied");
});

test("DSH envelope layout is normalized without changing the original file", async (t) => {
  const raw = '\uFEFF<|im_start|>system:<project_instructions>\r\nExample role.  \r\n';
  const h = harness(t, raw);
  await h.run();
  const result = await h.event("context_with_system", { messages: transcript() });
  assert.ok(result.messages[0].sections.preamble.startsWith("<|im_start|>system:\n<project_instructions>\nExample role.\n</project_instructions>"));
  assert.equal(readFileSync(h.sourceFile, "utf8"), raw);
});

test("status is read-only, toggles are idempotent and off restores the original request", async (t) => {
  const h = harness(t);
  await h.event("session_start");
  assert.equal((await h.status()).assembly, "not_run");
  await h.command("on");
  await h.command("on");
  await h.run();
  const first = await h.event("context_with_system", { messages: transcript() });
  const second = await h.event("context_with_system", { messages: first.messages });
  assert.equal(instruction(first.messages), instruction(second.messages));
  assert.equal(instruction(second.messages).split(PRIVATE).length - 1, 1);
  await h.command("off");
  await h.run();
  assert.equal(await h.event("context_with_system", { messages: transcript() }), undefined);
  assert.equal((await h.status()).enabled, false);
  await h.event("session_start");
  assert.equal((await h.status()).enabled, true);
});

test("observes serialized requests without mutation or content disclosure", async (t) => {
  const h = harness(t);
  await h.run();
  const projected = await h.event("context_with_system", { messages: transcript() });
  const payload = {
    input: [{ role: "developer", content: [{ type: "input_text", text: instruction(projected.messages) }] }, { role: "user", content: "USER_PRIVATE_FIXTURE" }],
    tools: [{ type: "function", name: "read", parameters: { secret: "TOOL_PRIVATE_FIXTURE" } }],
    headers: { Authorization: "HEADER_PRIVATE_FIXTURE" }, reasoning: { effort: "max" },
  };
  const snapshot = structuredClone(payload);
  assert.equal(await h.event("before_provider_request", { payload }), undefined);
  assert.deepEqual(payload, snapshot);
  const state = await h.status();
  assert.equal(state.request.bodyPresent, true);
  assert.deepEqual(state.request.instructionRoles, ["developer"]);
  assert.deepEqual(state.request.messageOrder, ["developer", "user"]);
  assert.deepEqual(state.request.tools, ["read"]);
  assert.equal(state.request.reasoning, "max");
  assert.match(state.source.sha256, /^[a-f0-9]{64}$/);
  for (const secret of [PRIVATE, "USER_PRIVATE_FIXTURE", "TOOL_PRIVATE_FIXTURE", "HEADER_PRIVATE_FIXTURE"]) {
    assert.ok(![...h.notifications, ...h.reports].join("\n").includes(secret));
  }
});

for (const failure of ["missing", "unreadable", "empty", "invalid_utf8"]) {
  test(`${failure} source fails visibly without changing the original request`, async (t) => {
    const h = harness(t);
    if (failure === "missing") rmSync(h.sourceFile);
    if (failure === "unreadable") { rmSync(h.sourceFile); mkdirSync(h.sourceFile); }
    if (failure === "empty") writeFileSync(h.sourceFile, " \n\t");
    if (failure === "invalid_utf8") writeFileSync(h.sourceFile, Buffer.from([0xff, 0xfe]));
    await h.run();
    const original = transcript();
    const snapshot = structuredClone(original);
    assert.equal(await h.event("context_with_system", { messages: original }), undefined);
    assert.deepEqual(original, snapshot);
    const state = await h.status();
    assert.equal(state.assembly, "failed");
    assert.equal(state.source, null);
    assert.equal(state.request, null);
    assert.ok(h.notifications.some((value) => value.includes("未生效")));
  });
}

test("unstructured or forced system overrides fail open without replacing the normal prompt", async (t) => {
  const h = harness(t);
  await h.run();
  assert.equal(await h.event("context_with_system", { messages: [{ role: "system", content: "OPAQUE_HOST" }] }), undefined);
  assert.equal((await h.status()).failure, "unstructured_system_prompt");
  await h.event("before_agent_start", { systemPromptOptions: { forceSystemPrompt: "OPAQUE_HOST" } });
  assert.equal((await h.status()).failure, "opaque_system_override");
});

test("unsupported Pi versions remain inert", async (t) => {
  const h = harness(t, PRIVATE, "0.84.3");
  await h.event("session_start");
  await h.run();
  assert.equal(await h.event("context_with_system", { messages: transcript() }), undefined);
  assert.equal((await h.status()).compatible, false);
});

test("known payload missing instructions reports a mismatch; an unknown shape remains unknown", async (t) => {
  const h = harness(t);
  await h.run();
  await h.event("context_with_system", { messages: transcript() });
  await h.event("before_provider_request", { payload: { input: [{ role: "user", content: "ordinary" }] } });
  assert.equal((await h.status()).request.bodyPresent, false);
  assert.ok(h.notifications.some((message) => message.includes("未找到完整目标正文")));
  await h.event("before_provider_request", { payload: { unrecognized: "PRIVATE_UNKNOWN" } });
  assert.equal((await h.status()).request.bodyPresent, null);
  assert.ok(!h.notifications.join("\n").includes("PRIVATE_UNKNOWN"));
});

test("later preamble patches neither reintroduce host identity nor duplicate the target body", async (t) => {
  const h = harness(t);
  await h.run();
  const original: any[] = [
    ...transcript(),
    { role: "system", content: "", sections: { preamble: "NEW_HOST", rules: "NEW_RULE" }, toolsAdded: [{ name: "extra" }], timestamp: 3 },
    { role: "system", content: "", sections: { preamble: null }, timestamp: 4 },
  ];
  const snapshot = structuredClone(original);
  const result = await h.event("context_with_system", { messages: original });
  assert.equal(JSON.stringify(result.messages).split(PRIVATE).length - 1, 1);
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[2].sections.rules, "NEW_RULE");
  assert.deepEqual(result.messages[2].toolsAdded, [{ name: "extra" }]);
  assert.ok(!JSON.stringify(result.messages).includes("NEW_HOST"));
  assert.deepEqual(original, snapshot);
});

test("compaction continuation and model changes retain the run snapshot and invalidate old observations", async (t) => {
  const h = harness(t);
  await h.run();
  await h.event("context_with_system", { messages: transcript() });
  await h.event("before_provider_request", { payload: { messages: [{ role: "system", content: `${PRIVATE}\nRole instructions.` }] } });
  assert.equal((await h.status()).request.bodyPresent, true);
  await h.event("agent_end");
  await h.event("session_compact");
  assert.equal((await h.status()).request, null);
  await h.event("agent_start");
  assert.ok(await h.event("context_with_system", { messages: transcript() }));
  h.ctx.model = { ...h.ctx.model!, provider: "other-provider", id: "other-model" };
  await h.event("model_select");
  assert.equal((await h.status()).request, null);
  assert.equal((await h.status()).currentModel.id, "other-model");
  assert.ok(await h.event("context_with_system", { messages: transcript() }));
  await h.event("agent_end");
  await h.command("off");
  await h.event("model_select");
  await h.event("agent_start");
  assert.equal(await h.event("context_with_system", { messages: transcript() }), undefined);
  assert.equal((await h.status()).enabled, false);
});

test("success followed by source loss cannot reuse old body or request evidence; repair can re-enable", async (t) => {
  const h = harness(t);
  await h.run();
  await h.event("context_with_system", { messages: transcript() });
  await h.event("before_provider_request", { payload: { input: [{ role: "developer", content: `${PRIVATE}\nRole instructions.` }] } });
  await h.event("agent_end");
  rmSync(h.sourceFile);
  await h.run();
  assert.equal(await h.event("context_with_system", { messages: transcript() }), undefined);
  const failed = await h.status();
  assert.equal(failed.assembly, "failed");
  assert.equal(failed.source, null);
  assert.equal(failed.request, null);
  writeFileSync(h.sourceFile, "REPAIRED_ROLE", "utf8");
  await h.command("on");
  await h.run();
  const result = await h.event("context_with_system", { messages: transcript() });
  assert.ok(result.messages[0].sections.preamble.startsWith("REPAIRED_ROLE"));
  assert.ok(!instruction(result.messages).includes(PRIVATE));
});

for (const mode of ["rpc", "json", "print"]) {
  test(`${mode} uses available UI or stderr, never terminal-only UI or private content`, async (t) => {
    const h = harness(t, PRIVATE, "1.4.0", mode);
    await h.event("session_start");
    await h.run();
    const projection = await h.event("context_with_system", { messages: transcript() });
    await h.event("before_provider_request", { payload: { messages: [{ role: "system", content: instruction(projection.messages) }] } });
    assert.equal((await h.status()).request.bodyPresent, true);
    if (mode !== "rpc") assert.ok(h.reports.length > 0);
    assert.equal(h.statuses.length, 0);
    assert.ok(![...h.reports, ...h.notifications].join("\n").includes(PRIVATE));
    await h.event("session_shutdown");
  });
}

test("cancelled source read leaves no projection or stale success, and shutdown is idempotent", async (t) => {
  const h = harness(t);
  h.ctx.signal = AbortSignal.abort();
  await h.run();
  assert.equal((await h.status()).failure, "cancelled");
  assert.equal(await h.event("context_with_system", { messages: transcript() }), undefined);
  await h.event("session_shutdown");
  await h.event("session_shutdown");
  assert.equal(h.statuses.at(-1), undefined);
});

test("Anthropic and Chat Completions observations recognize instructions without touching payloads", async (t) => {
  const h = harness(t);
  await h.run();
  for (const payload of [
    { system: [{ type: "text", text: `${PRIVATE}\nRole instructions.` }], messages: [{ role: "user", content: "private" }], tools: [{ name: "read" }] },
    { messages: [{ role: "system", content: `${PRIVATE}\nRole instructions.` }, { role: "user", content: "private" }], tools: [{ type: "function", function: { name: "read" } }] },
  ]) {
    const snapshot = structuredClone(payload);
    await h.event("before_provider_request", { payload });
    const state = await h.status();
    assert.equal(state.request.bodyPresent, true);
    assert.deepEqual(state.request.tools, ["read"]);
    assert.deepEqual(payload, snapshot);
  }
});

test("default prompt is packaged locally and needs no external prompt file", async (t) => {
  const h = harness(t, PRIVATE, "1.4.0", "print", true);
  rmSync(h.sourceFile);
  await h.run();
  const state = await h.status();
  const expected = new URL("../prompts/default.md", import.meta.url);
  const bytes = readFileSync(expected);
  assert.equal(state.assembly, "prepared");
  assert.equal(state.source.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(state.source.bytes, bytes.length);
  assert.ok(!state.sourceFile.includes(".dsh"));
  const projection = await h.event("context_with_system", { messages: transcript() });
  assert.ok(projection.messages[0].sections.preamble.includes("<pi_host>"));
});
