import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parse } from "jsonc-parser";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import modelDetect from "../src/index.ts";

process.env.PI_OFFLINE = "1";
export const SECRET = "PRIVATE_FIXTURE_MUST_NOT_APPEAR";
export const model = (id = "a", extra: object = {}) => ({ id, name: "Display " + id, contextWindow: 20000, maxTokens: 1000, reasoning: true,
  thinkingLevelMap: { off: "none", high: "high", max: "max" }, input: ["text"], cost: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 }, ...extra });
export const entry = (id = "a", extra: object = {}) => ({ id, name: "Directory " + id, limit: { context: 400000, output: 128000 }, modalities: { input: ["text", "image", "pdf"] },
  reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "high"] }], cost: { input: 1.25, output: 10, cache_read: 0.125 }, ...extra });

export async function fixture(options: Parameters<typeof modelDetect>[1] & { definitions?: object[]; provider?: string; config?: object; directory?: object; mode?: "rpc" | "print" | "tui" } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-model-detect-test-"));
  const agentDir = join(cwd, "agent");
  await mkdir(agentDir);
  const provider = options.provider ?? "fixture";
  const initial = options.config ?? { providers: { [provider]: { api: "openai-responses", baseUrl: "http://127.0.0.1:1/v1", apiKey: SECRET,
    headers: { "X-Test": SECRET }, models: options.definitions ?? [model()] } } };
  const original = Buffer.from("\uFEFF// Model Detect test comment\r\n" + JSON.stringify(initial, null, 2).replace(/\n/g, "\r\n") + "\r\n", "utf8");
  const configPath = join(agentDir, "models.json");
  await writeFile(configPath, original);
  const data = { directory: options.directory ?? { [provider]: { models: { a: entry() } } }, status: 200, malformed: false, contentType: "application/json", stall: false, requests: 0 };
  let requested: (() => void) | undefined;
  const requestSeen = () => new Promise<void>(done => { requested = done; });
  const server = createServer((_request, response) => {
    data.requests++; requested?.();
    if (data.stall) return;
    response.writeHead(data.status, { "Content-Type": data.contentType });
    response.end(data.malformed ? "broken-json" : JSON.stringify(data.directory));
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const notices: string[] = [], errors: string[] = [], previews: string[] = [], selectionLists: string[][] = [];
  const answers: (string | undefined)[] = [];
  const frames: string[][] = [], uiKeys: string[] = [];
  let terminalInput: ((data: string) => unknown) | undefined;
  let consent = true;
  let beforeConfirm: (() => Promise<void>) | undefined;
  const ui = {
    input: async () => answers.shift(),
    select: async (_title: string, values: string[]) => { selectionLists.push(values); return values[0]; },
    confirm: async (_title: string, text: string) => { previews.push(text); await beforeConfirm?.(); return consent; },
    notify: (text: string) => notices.push(text),
    onTerminalInput: (handler: (data: string) => unknown) => { terminalInput = handler; return () => { terminalInput = undefined; }; },
    custom: async (factory: any) => {
      let result: boolean | undefined;
      const component = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_color: string, text: string) => text }, {}, (value: boolean) => { result = value; });
      frames.push(component.render(80));
      for (const key of uiKeys.length ? uiKeys : ['\r']) { component.handleInput(key); frames.push(component.render(80)); }
      component.dispose(); return result;
    },
  } as unknown as ExtensionUIContext;
  const settingsManager = SettingsManager.create(cwd, agentDir);
  settingsManager.setDefaultModelAndProvider(provider, (options.definitions?.[0] as { id: string } | undefined)?.id ?? "a");
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noContextFiles: true,
    disabledBuiltinExtensions: ["mcp"], extensionFactories: [(pi) => modelDetect(pi, { agentDir, catalogUrl: `http://127.0.0.1:${address.port}/api.json`, ...options })] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
  await session.bindExtensions({ mode: options.mode ?? "rpc", uiContext: ui });
  let modelRuns = 0;
  const unlisten = session.subscribe(event => { if (event.type === "agent_start") modelRuns++; });
  const unerror = session.extensionRunner!.onError(error => { errors.push(error.error); });
  return {
    cwd, agentDir, original, configPath, session, data, notices, errors, previews, answers, selectionLists, requestSeen, frames, uiKeys,
    terminalKey: (data: string) => terminalInput?.(data),
    consent: (value: boolean) => { consent = value; }, beforeConfirm: (fn: () => Promise<void>) => { beforeConfirm = fn; },
    command: async (text = `/detect ${provider}/a`) => { await session.prompt(text); assert.equal(modelRuns, 0); assert.ok(![...notices, ...previews, ...errors].join("\n").includes(SECRET)); },
    config: async () => parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, "")),
    state: async () => parse(await readFile(join(agentDir, "model-detect.json"), "utf8")),
    backups: async () => { try { return await readdir(join(agentDir, "model-detect", "backups")); } catch { return []; } },
    loaded: async (id = "a") => {
      const runtime = await ModelRuntime.create({ modelsPath: configPath, authPath: join(agentDir, "auth.json"), refreshOnCreate: false });
      assert.equal(runtime.getError(), undefined);
      const loaded = runtime.getModel(provider, id); assert.ok(loaded); return loaded;
    },
    close: async () => {
      await session.extensionRunner!.emit({ type: "session_shutdown", reason: "quit" }); unlisten(); unerror(); session.dispose();
      server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
      const absolute = resolve(cwd); assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && absolute.includes("pi-model-detect-test-"));
      await rm(absolute, { recursive: true, force: true });
    },
  };
}
