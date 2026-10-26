import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import piPurge from "../src/index.ts";

const BODY = "SOURCE_BODY_MARKER\nFixture role instructions.";
const piBinary = process.platform === "win32" ? "pi.exe" : "pi";

function instruction(payload: any) {
  return (payload.input ?? []).filter((item: any) => ["system", "developer"].includes(item.role))
    .flatMap((item: any) => typeof item.content === "string" ? [item.content] : (item.content ?? []).map((part: any) => part.text ?? "")).join("\n");
}

function respond(response: ServerResponse, number: number, tool: boolean) {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (type: string, fields: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  const item = tool
    ? { id: `fc_${number}`, type: "function_call", call_id: `call_${number}`, name: "read", arguments: '{"path":"fixture.txt"}', status: "completed" }
    : { id: `msg_${number}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "MOCK_RESPONSE", annotations: [] }] };
  emit("response.created", { response: { id: `resp_${number}` } });
  emit("response.output_item.added", { output_index: 0, item: tool ? { ...item, arguments: "" } : { ...item, content: [] } });
  if (tool) emit("response.function_call_arguments.delta", { output_index: 0, delta: item.arguments });
  else emit("response.output_text.delta", { output_index: 0, content_index: 0, delta: "MOCK_RESPONSE" });
  emit("response.output_item.done", { output_index: 0, item });
  emit("response.completed", { response: { id: `resp_${number}`, status: "completed", output: [item], usage: { input_tokens: 1500, output_tokens: 10, total_tokens: 1510 } } });
  response.end();
}

test("real Pi contracts: tools, multi-turn, models, compaction, reload, source recovery, cancellation and CLI modes", { timeout: 120_000 }, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-purge-host-"));
  const agentDir = join(cwd, "agent");
  const sourceFile = join(cwd, "prompt.md");
  await mkdir(agentDir);
  await writeFile(sourceFile, BODY, "utf8");
  await writeFile(join(cwd, "fixture.txt"), "42", "utf8");
  const requests: any[] = [];
  let toolPending = false;
  let stall = false;
  let overflowPending = false;
  let sawRequest: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    sawRequest?.();
    if (stall) { response.writeHead(200, { "Content-Type": "text/event-stream" }); response.flushHeaders(); return; }
    if (overflowPending) {
      overflowPending = false;
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "maximum context length exceeded", code: "context_length_exceeded", type: "invalid_request_error" } }));
      return;
    }
    const tool = toolPending;
    toolPending = false;
    respond(response, requests.length, tool);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const models = ["model-a", "model-b"].map((id) => ({ id, name: id, reasoning: true, input: ["text"], contextWindow: 100000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-responses", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "fixture-only-not-a-secret", models } } }), "utf8");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "model-a" }), "utf8");
  const notices: string[] = [];
  const diagnostics: string[] = [];
  const settingsManager = SettingsManager.inMemory({ defaultProvider: "fixture", defaultModel: "model-a", compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 32 } });
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, disabledBuiltinExtensions: ["mcp"],
    extensionFactories: [(pi) => piPurge(pi, { sourceFile, report: (message) => diagnostics.push(message) })],
  });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await loader.reload();
    session = (await createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(cwd) })).session;
    await session.bindExtensions({ mode: "rpc", uiContext: { notify: (message: string) => { notices.push(message); } } as unknown as ExtensionUIContext });
    const state = async () => { await session!.prompt("/purge status"); return JSON.parse(notices.at(-1)!); };
    await t.test("normal and tool continuation requests retain exactly one body", async () => {
      toolPending = true;
      await session!.prompt("Read fixture.txt.");
      await session!.prompt("Second ordinary turn.");
      assert.equal(requests.length, 3);
      assert.ok(requests.every((payload) => instruction(payload).split("SOURCE_BODY_MARKER").length - 1 === 1));
      assert.equal((await state()).request.bodyPresent, true);
      assert.ok(!JSON.stringify(session!.state.messages).includes("SOURCE_BODY_MARKER"));
    });
    await t.test("actual model selection invalidates evidence and preserves the on/off state", async () => {
      await session!.setModel(session!.modelRuntime.getModel("fixture", "model-b")!);
      assert.equal((await state()).request, null);
      await session!.prompt("Another model.");
      assert.equal(requests.at(-1).model, "model-b");
      assert.ok(instruction(requests.at(-1)).includes(BODY));
      await session!.prompt("/purge off");
      await session!.setModel(session!.modelRuntime.getModel("fixture", "model-a")!);
      await session!.prompt("Disabled after model switch.");
      assert.equal((await state()).enabled, false);
      assert.ok(!instruction(requests.at(-1)).includes(BODY));
    });
    await t.test("native compaction stays native and the following request restores the target body", async () => {
      await session!.prompt("/purge on");
      await session!.prompt("Before compaction.");
      await session!.compact();
      assert.ok(!instruction(requests.at(-1)).includes(BODY), "compaction was incorrectly injected");
      assert.equal((await state()).request, null);
      await session!.prompt("Continue after native compaction.");
      assert.equal((await state()).request.bodyPresent, true);
      assert.equal(instruction(requests.at(-1)).split("SOURCE_BODY_MARKER").length - 1, 1);
    });
    await t.test("automatic overflow compaction retries with the same target body without a new user turn", async () => {
      session!.setAutoCompactionEnabled(true);
      overflowPending = true;
      const before = requests.length;
      await session!.prompt("Recover from a single context overflow.");
      const recovery = requests.slice(before);
      const injected = recovery.map((payload) => instruction(payload).includes(BODY));
      assert.equal(injected.filter(Boolean).length, 2, JSON.stringify(injected));
      assert.ok(injected.some((value) => !value), "no native compaction request observed");
      assert.equal(injected.at(-1), true, "continued agent request lost its target body");
      assert.equal((await state()).request.bodyPresent, true);
      session!.setAutoCompactionEnabled(false);
    });
    await t.test("reload resets the session switch without persisting old state", async () => {
      await session!.prompt("/purge off");
      await session!.reload();
      assert.equal((await state()).enabled, true);
      await session!.prompt("After reload.");
      assert.equal((await state()).request.bodyPresent, true);
    });
    await t.test("mid-session source failure restores the host, and repair re-enables", async () => {
      await writeFile(sourceFile, "   \n", "utf8");
      await session!.prompt("Source unavailable.");
      assert.ok(instruction(requests.at(-1)).includes("expert coding assistant"));
      assert.ok(!instruction(requests.at(-1)).includes(BODY));
      assert.equal((await state()).assembly, "failed");
      assert.equal((await state()).request, null);
      await writeFile(sourceFile, BODY, "utf8");
      await session!.prompt("/purge on");
      await session!.prompt("Source repaired.");
      assert.equal((await state()).request.bodyPresent, true);
    });
    await t.test("actual request cancellation does not retry and a new turn remains usable", async () => {
      stall = true;
      const received = new Promise<void>((resolve) => { sawRequest = resolve; });
      const before = requests.length;
      const pending = session!.prompt("Cancel this request.");
      await received;
      sawRequest = undefined;
      await session!.abort();
      await pending;
      assert.equal(requests.length, before + 1);
      stall = false;
      await session!.prompt("After cancellation.");
      assert.equal((await state()).request.bodyPresent, true);
    });
    const wrapper = join(cwd, "extension.ts");
    const entry = pathToFileURL(fileURLToPath(new URL("../src/index.ts", import.meta.url))).href;
    await writeFile(wrapper, `import purge from ${JSON.stringify(entry)};\nexport default (pi) => purge(pi, { sourceFile: ${JSON.stringify(sourceFile)} });\n`, "utf8");
    const base = ["--offline", "--no-mcp", "--no-extensions", "--no-skills", "-e", wrapper];
    const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
    const cli = (args: string[]) => {
      const result = promisify(execFile)(piBinary, [...base, ...args], { cwd, env, timeout: 30_000, maxBuffer: 4_000_000 });
      // Print mode reads piped stdin to EOF before it starts the supplied prompt.
      result.child.stdin?.end();
      return result;
    };
    await t.test("real print and JSON modes keep stdout consumable, including source failure", async () => {
      const normal = await cli(["--no-session", "-p", "Ordinary text response."]);
      assert.ok(normal.stdout.includes("MOCK_RESPONSE"));
      assert.ok(normal.stderr.includes('"bodyPresent":true'));
      const jsonNormal = await cli(["--no-session", "--mode", "json", "-p", "Ordinary JSON response."]);
      assert.ok(jsonNormal.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line)).some((event) => event.type === "agent_end"));
      assert.ok(!jsonNormal.stdout.includes("SOURCE_BODY_MARKER"));
      assert.ok(jsonNormal.stderr.includes('"bodyPresent":true'));
      await writeFile(sourceFile, " ", "utf8");
      const failed = await cli(["--no-session", "--mode", "json", "-p", "Ordinary fallback response."]);
      const events = failed.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
      assert.ok(events.some((event) => event.type === "agent_end"));
      assert.ok(failed.stderr.includes("未生效"));
      assert.ok(!instruction(requests.at(-1)).includes(BODY));
      await writeFile(sourceFile, BODY, "utf8");
    });
    await t.test("actual session resume and fork start enabled", async () => {
      const savedSession = join(cwd, "saved.jsonl");
      await cli(["--session", savedSession, "-p", "Save this fixture conversation."]);
      const resumed = await cli(["--session", savedSession, "-p", "/purge status"]);
      assert.ok(resumed.stderr.includes('"enabled": true'));
      const forked = await cli(["--fork", savedSession, "--session-dir", join(cwd, "sessions"), "-p", "/purge status"]);
      assert.ok(forked.stderr.includes('"enabled": true'));
    });
    await t.test("native RPC commands and new-session lifecycle preserve protocol and reset defaults", async () => {
      const child = spawn(piBinary, [...base, "--no-session", "--mode", "rpc"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      const lines = createInterface({ input: child.stdout });
      const events: any[] = [];
      const pending = new Map<string, (event: any) => void>();
      let rpcStderr = "";
      child.stderr.on("data", (chunk) => { rpcStderr += chunk; });
      lines.on("line", (line) => {
        const event = JSON.parse(line);
        events.push(event);
        if (event.type === "response") pending.get(event.id)?.(event);
      });
      let sequence = 0;
      const rpc = (type: string, fields: object = {}) => new Promise<any>((resolve, reject) => {
        const id = String(++sequence);
        const timer = setTimeout(() => reject(new Error(`RPC ${type} timeout`)), 10_000);
        pending.set(id, (event) => { clearTimeout(timer); pending.delete(id); resolve(event); });
        child.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n");
      });
      const rpcStatus = () => JSON.parse(events.filter((event) => event.type === "extension_ui_request" && event.method === "notify").at(-1).message);
      try {
        assert.equal((await rpc("prompt", { message: "/purge off" })).success, true);
        await rpc("prompt", { message: "/purge status" });
        assert.equal(rpcStatus().enabled, false);
        assert.equal((await rpc("new_session")).success, true);
        await rpc("prompt", { message: "/purge status" });
        assert.equal(rpcStatus().enabled, true);
        assert.equal(rpcStderr, "");
      } finally {
        child.stdin.end();
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
        lines.close();
      }
    });
    await t.test("publication files alone run outside the repository without another application's resources", async () => {
      const packageRoot = fileURLToPath(new URL("../", import.meta.url));
      const releaseRoot = join(cwd, "release package with spaces");
      const emptyHome = join(cwd, "clean home");
      await mkdir(releaseRoot);
      await mkdir(emptyHome);
      const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
      assert.equal(manifest.private, undefined);
      assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
      assert.ok(manifest.files.includes("prompts"));
      await writeFile(join(releaseRoot, "package.json"), JSON.stringify(manifest), "utf8");
      for (const relative of manifest.files) {
        assert.ok(!relative.includes("..") && !relative.includes(":"));
        await cp(join(packageRoot, relative), join(releaseRoot, relative), { recursive: true });
      }
      const args = [...base.slice(0, -2), "-e", releaseRoot, "--no-session", "-p"];
      const run = (prompt: string) => {
        const result = promisify(execFile)(piBinary, [...args, prompt], {
          cwd, env: { ...env, HOME: emptyHome, USERPROFILE: emptyHome }, timeout: 30_000, maxBuffer: 4_000_000,
        });
        result.child.stdin?.end();
        return result;
      };
      const status = await run("/purge on");
      assert.ok(status.stderr.includes(JSON.stringify(join(releaseRoot, "prompts", "default.md"))));
      assert.ok(!status.stderr.includes('"assembly": "failed"'));
      const ordinary = await run("Ordinary standalone package request.");
      assert.ok(ordinary.stdout.includes("MOCK_RESPONSE"));
      assert.ok(ordinary.stderr.includes('"bodyPresent":true'));
      assert.ok(instruction(requests.at(-1)).includes("<pi_host>"));
    });
    assert.ok(![...notices, ...diagnostics].join("\n").includes("SOURCE_BODY_MARKER"));
  } finally {
    if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.ok(cwd.startsWith(join(tmpdir(), "pi-purge-host-")));
    await rm(cwd, { recursive: true, force: true });
  }
});
