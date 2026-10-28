import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import piSync from "../src/index.ts";
import { run } from "../src/io.ts";
import { fixture, GIT_ENV, json, parsed, text } from "./harness.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const PI = process.platform === "win32" ? "pi.exe" : "pi";

export function cleanEnvironment(agentDir: string, home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)));
  return { ...env, ...GIT_ENV, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(home, "sessions"), PI_OFFLINE: "1", HOME: home, USERPROFILE: home,
    PI_SYNC_FIXTURE_KEY: "fixture-not-a-real-key", GIT_CONFIG_GLOBAL: join(home, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", NPM_CONFIG_USERCONFIG: join(home, "npmrc"), NPM_CONFIG_REGISTRY: "https://registry.npmmirror.com" };
}

async function model(agentDir: string) {
  await json(join(agentDir, "settings.json"), { defaultProvider: "fixture", defaultModel: "fixture-model", theme: "dark" });
  await json(join(agentDir, "models.json"), { providers: { fixture: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "$PI_SYNC_FIXTURE_KEY",
    models: [{ id: "fixture-model", name: "Fixture model", contextWindow: 32000, maxTokens: 1024 }] } } });
}

export async function nativeSmoke() {
  const f = await fixture();
  const home = join(f.directory, "isolated home");
  await mkdir(home);
  const results: string[] = [];
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    await model(f.source);
    await text(join(f.source, "prompts", "smoke.md"), "Native Pi command smoke fixture.\n");
    const notices: string[] = [];
    const settingsManager = SettingsManager.create(f.directory, f.source);
    const loader = new DefaultResourceLoader({ cwd: f.directory, agentDir: f.source, settingsManager, noSkills: true, disabledBuiltinExtensions: ["mcp"],
      extensionFactories: [(pi) => piSync(pi, { agentDir: f.source, run: f.execute })] });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: f.directory, agentDir: f.source, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(f.directory) });
    let modelRuns = 0;
    const unsubscribe = session.subscribe((event) => { if (event.type === "agent_start") modelRuns++; });
    try {
      await session.bindExtensions({ mode: "rpc", uiContext: { notify: (message: string) => { notices.push(message); } } as unknown as ExtensionUIContext });
      await session.prompt(`/sync setup "${f.remote}"`);
      assert.match(notices.at(-1)!, /连接成功/);
      await session.prompt("/sync save");
      assert.match(notices.at(-1)!, /保存成功/);
      await session.prompt("/sync status");
      assert.match(notices.at(-1)!, /远端：[a-f0-9]{40}/);
      assert.equal(modelRuns, 0, "extension commands unexpectedly started an AI run");
      results.push("real SDK: registered setup/save/status; no model requests");
    } finally { unsubscribe(); await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }

    const base = ["--offline", "--no-mcp", "--no-extensions", "--no-skills", "--no-session", "-e", packageRoot];
    const cli = async (agentDir: string, command: string, jsonMode = false) => {
      const result = await run(PI, [...base, ...(jsonMode ? ["--mode", "json"] : []), "-p", command], { cwd: f.directory, env: cleanEnvironment(agentDir, home), timeout: 60_000 });
      assert.equal(result.code, 0, result.stderr);
      return result;
    };
    await model(f.target);
    assert.match((await cli(f.target, `/sync setup "${f.remote}"`)).stderr, /连接成功/);
    const restore = await cli(f.target, "/sync restore");
    assert.match(restore.stderr, /还原成功.*待鉴权.*待重启/s);
    assert.equal(await readFile(join(f.target, "prompts", "smoke.md"), "utf8"), "Native Pi command smoke fixture.\n");
    const settings = await parsed(join(f.target, "settings.json"));
    assert.equal(settings.defaultModel, "fixture-model");
    const jsonResult = await cli(f.target, "/sync status", true);
    for (const line of jsonResult.stdout.trim().split(/\r?\n/).filter(Boolean)) JSON.parse(line);
    assert.match(jsonResult.stderr, /没有待恢复/);
    const missing = await cli(f.target, "/sync include ../escape");
    assert.match(missing.stderr, /非法|相对路径/);
    results.push("real CLI: pi -e package; print setup/restore/status/error; JSON stdout remains parseable");

    const child = spawn(PI, [...base, "--mode", "rpc"], { cwd: f.directory, env: cleanEnvironment(f.target, home), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout });
    const events: any[] = [];
    const pending = new Map<string, (value: any) => void>();
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    lines.on("line", (line) => {
      const event = JSON.parse(line); events.push(event);
      if (event.type === "response") pending.get(event.id)?.(event);
    });
    let sequence = 0;
    const rpc = (message: string) => new Promise<any>((resolveResult, reject) => {
      const id = String(++sequence);
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${message}; ${stderr}`)); }, 30_000);
      pending.set(id, (event) => { clearTimeout(timeout); pending.delete(id); resolveResult(event); });
      child.stdin.write(JSON.stringify({ id, type: "prompt", message }) + "\n");
    });
    try {
      assert.equal((await rpc("/sync status")).success, true);
      assert.ok(events.some((event) => event.type === "extension_ui_request" && event.method === "notify" && /Pi Sync/.test(event.message)));
      await rpc("/sync save");
      assert.ok(events.some((event) => event.type === "extension_ui_request" && /保存成功/.test(event.message)));
      assert.ok(!events.some((event) => event.type === "agent_start"));
      results.push("real RPC: status/save notify events, valid JSONL, no model run");
    } finally {
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 5000);
      await new Promise<void>((done) => { if (child.exitCode !== null) done(); else child.once("exit", () => done()); });
      clearTimeout(timeout); lines.close();
    }
    return { platform: process.platform, node: process.version, results };
  } finally {
    if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
    await f.cleanup();
  }
}
