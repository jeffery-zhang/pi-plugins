import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const cwd = await mkdtemp(join(tmpdir(), "pi-model-detect-smoke-"));
const agentDir = join(cwd, "agent");
await mkdir(agentDir);
const configuration = JSON.stringify({ providers: { fixture: { api: "openai-responses", baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-only",
  models: ["a", "b"].map(id => ({ id, reasoning: false, contextWindow: 10000, maxTokens: 1000 })) } } }, null, 2);
await writeFile(join(agentDir, "models.json"), configuration, "utf8");
await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "a", theme: "dark" }), "utf8");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)));
const child = spawn(process.platform === "win32" ? "pi.exe" : "pi", ["--offline", "--no-mcp", "--no-extensions", "--no-skills", "--no-context-files", "--no-session", "--mode", "rpc", "-e", fileURLToPath(new URL("../", import.meta.url))],
  { cwd, windowsHide: true, env: { ...env, PI_CODING_AGENT_DIR: agentDir, HOME: cwd, USERPROFILE: cwd, PI_OFFLINE: "1", PI_TELEMETRY: "0" }, stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: child.stdout });
let stderr = "", modelRuns = 0, confirmations = 0, consent = false;
const notices: string[] = [], previews: string[] = [];
const inputs: string[] = [];
const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: Error) => void }>();
child.stderr.on("data", chunk => { stderr += String(chunk); });
const send = (value: object) => child.stdin.write(JSON.stringify(value) + "\n");
lines.on("line", line => {
  let event: any;
  try { event = JSON.parse(line); } catch { for (const request of pending.values()) request.reject(new Error("Invalid RPC JSON")); return; }
  if (event.type === "agent_start") modelRuns++;
  if (event.type === "response") pending.get(event.id)?.resolve(event);
  if (event.type !== "extension_ui_request") return;
  if (event.method === "notify") notices.push(event.message);
  if (event.method === "input") {
    const value = inputs.shift();
    send({ type: "extension_ui_response", id: event.id, value, cancelled: value === undefined });
  }
  if (event.method === "select") send({ type: "extension_ui_response", id: event.id, value: event.options[0] });
  if (event.method === "confirm") { confirmations++; previews.push(event.message); send({ type: "extension_ui_response", id: event.id, confirmed: consent }); }
});
let sequence = 0;
async function command(message: string) {
  const id = String(++sequence);
  return new Promise<any>((resolveResult, rejectResult) => {
    const timer = setTimeout(() => { pending.delete(id); rejectResult(new Error("RPC timeout: " + stderr)); }, 60_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); pending.delete(id); resolveResult(value); }, reject: error => { clearTimeout(timer); rejectResult(error); } });
    send({ id, type: "prompt", message });
  });
}
try {
  inputs.push("openai/gpt-5");
  assert.equal((await command("/detect fixture/a")).success, true);
  assert.equal(confirmations, 1);
  assert.equal(await readFile(join(agentDir, "models.json"), "utf8"), configuration);
  await assert.rejects(readFile(join(agentDir, "model-detect.json")), { code: "ENOENT" });
  consent = true;
  inputs.push("openai/gpt-5", "openai/gpt-4o-mini");
  assert.equal((await command("/detect fixture")).success, true);
  assert.equal(confirmations, 2);
  assert.equal(modelRuns, 0);
  const result = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8"));
  assert.equal(result.providers.fixture.models.length, 2);
  assert.ok(result.providers.fixture.modelOverrides.a.contextWindow > 10000);
  assert.ok(result.providers.fixture.modelOverrides.b.maxTokens > 1000);
  assert.deepEqual(JSON.parse(await readFile(join(agentDir, "model-detect.json"), "utf8")).sources,
    { "fixture/a": "openai/gpt-5", "fixture/b": "openai/gpt-4o-mini" });
  assert.ok(previews[1]!.includes("fixture/b ← openai/gpt-4o-mini"));
  assert.ok(notices.some(message => message.includes("重启 Pi 生效")));
  console.log(JSON.stringify({ host: "Pi 1.4.0", mode: "real CLI RPC", catalog: "live models.dev", models: 2, confirmations, modelRequests: modelRuns,
    passed: ["package loading via pi -e", "manual source input", "cancel leaves both files unchanged", "batch one confirmation", "metadata and mappings persisted", "restart notice"] }, null, 2));
} finally {
  child.stdin.end();
  const killTimer = setTimeout(() => child.kill(), 3000);
  if (child.exitCode === null) await new Promise<void>(done => child.once("exit", () => done()));
  clearTimeout(killTimer); lines.close();
  const absolute = resolve(cwd); assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes("pi-model-detect-smoke-"));
  await rm(absolute, { recursive: true, force: true });
}
