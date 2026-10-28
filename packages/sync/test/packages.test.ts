import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultPackageManager, DefaultResourceLoader, SessionManager, SettingsManager, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import piSync from "../src/index.ts";
import { exists, type Run } from "../src/io.ts";
import { fixture, harness, json, parsed, text } from "./harness.ts";

test("real Pi installs pinned npm/Git packages and rebuilds local dependencies from a local registry", { timeout: 240_000 }, async (t) => {
  const f = await fixture(t);
  const tarballs = new Map<string, Buffer>();
  const manifests = new Map<string, Record<string, any>>();
  for (const [name, version, body] of [
    ["@fixture/pi-sync-extension", "1.0.0", 'export default pi => pi.registerCommand("fixture-npm", { handler: async (_args, ctx) => ctx.ui.notify("npm fixture 1.0.0") });'],
    ["@fixture/pi-sync-extension", "2.0.0", 'export default pi => pi.registerCommand("fixture-npm", { handler: async (_args, ctx) => ctx.ui.notify("npm fixture 2.0.0") });'],
    ["@fixture/tiny", "1.0.0", 'export const value = "local dependency works";'],
    ["@earendil-works/pi-coding-agent", "1.4.0", 'throw new Error("the host-provided peer must not be installed or imported");'],
  ]) {
    const key = name.split("/").at(-1)! + "-" + version;
    const directory = join(f.directory, "package builds with spaces", key);
    await mkdir(directory, { recursive: true });
    const manifest = { name, version, type: "module", main: "index.js", ...(name.includes("extension") ? { pi: { extensions: ["./index.js"] }, peerDependencies: { "@earendil-works/pi-coding-agent": "*" } } : {}) };
    await json(join(directory, "package.json"), manifest);
    await text(join(directory, "index.js"), body);
    const packed = await f.execute("npm", ["pack", "--json", "--pack-destination", directory], { cwd: directory, timeout: 30_000 });
    assert.equal(packed.code, 0, packed.stderr);
    const filename = JSON.parse(packed.stdout)[0].filename;
    tarballs.set(key, await readFile(join(directory, filename)));
    manifests.set(key, manifest);
  }
  const serve = join(f.directory, "serve");
  const gitBuild = join(f.directory, "git source");
  const gitBare = join(serve, "owner", "fixture.git");
  await mkdir(gitBuild, { recursive: true });
  await f.git(["init", "--initial-branch=main", gitBuild]);
  await json(join(gitBuild, "package.json"), { name: "@fixture/git-extension", version: "1.0.0", type: "module", pi: { extensions: ["./index.ts"] } });
  await text(join(gitBuild, "index.ts"), 'export default pi => pi.registerCommand("fixture-git", { handler: async (_args, ctx) => ctx.ui.notify("git fixture fixed commit") });');
  await f.git(["-C", gitBuild, "add", "."]); await f.git(["-C", gitBuild, "commit", "-m", "fixture"]);
  await mkdir(join(serve, "owner"), { recursive: true });
  await f.git(["clone", "--bare", gitBuild, gitBare]);
  await f.git(["--git-dir", gitBare, "update-server-info"]);
  const commit = await f.git(["--git-dir", gitBare, "rev-parse", "main"]);
  let registry = "";
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url!, "http://fixture").pathname);
      if (path.startsWith("/tarballs/")) {
        const bytes = tarballs.get(path.slice("/tarballs/".length).replace(/\.tgz$/, ""));
        if (!bytes) { response.writeHead(404).end(); return; }
        response.writeHead(200, { "Content-Type": "application/octet-stream" }); response.end(bytes); return;
      }
      if (/^\/@(?:fixture|earendil-works)\//.test(path)) {
        const versions = Object.fromEntries([...manifests].filter(([_key, value]) => value.name === path.slice(1)).map(([key, value]) => {
          const bytes = tarballs.get(key)!;
          return [value.version, { ...value, dist: { tarball: `${registry}/tarballs/${key}.tgz`, shasum: createHash("sha1").update(bytes).digest("hex") } }];
        }));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ name: path.slice(1), "dist-tags": { latest: Object.keys(versions).sort().at(-1) }, versions })); return;
      }
      const filename = resolve(serve, "." + path);
      if (!filename.startsWith(resolve(serve) + sep)) { response.writeHead(403).end(); return; }
      const bytes = await readFile(filename);
      response.writeHead(200, { "Content-Type": "text/plain" }); response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address === "object");
  registry = `http://127.0.0.1:${address.port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); });
  const execute: Run = (command, args, options) => f.execute(command, args, { ...options, env: { ...options.env, NPM_CONFIG_REGISTRY: registry, npm_config_registry: registry, NPM_CONFIG_CACHE: join(f.directory, "npm-cache") } });
  const gitSource = `git:${registry}/owner/fixture.git`;
  for (const source of ["npm:@fixture/pi-sync-extension@1.0.0", gitSource]) {
    const installed = await execute(process.platform === "win32" ? "pi.exe" : "pi", ["install", source], { cwd: f.directory, env: { PI_CODING_AGENT_DIR: f.source, PI_OFFLINE: "1" }, timeout: 90_000 });
    assert.equal(installed.code, 0, installed.stderr + installed.stdout);
  }
  await json(join(f.source, "settings.json"), { packages: [{ source: "npm:@fixture/pi-sync-extension", extensions: ["+index.js"], skills: [] }, gitSource], theme: "dark" });
  await json(join(f.source, "extensions", "local", "package.json"), { name: "local-fixture", private: true, type: "module", dependencies: { "@fixture/tiny": "1.0.0" } });
  await text(join(f.source, "extensions", "local", "index.ts"), 'import { value } from "@fixture/tiny"; export default pi => pi.registerCommand("fixture-local", { handler: async (_args, ctx) => ctx.ui.notify(value) });');
  const sourceDependencies = await execute("npm", ["install", "--legacy-peer-deps", "--no-audit"], { cwd: join(f.source, "extensions", "local"), timeout: 60_000 });
  assert.equal(sourceDependencies.code, 0, sourceDependencies.stderr);
  const source = harness(f.source, execute); await source.command(`setup "${f.remote}"`); await source.command("save");
  const profile = JSON.parse(await f.git(["--git-dir", f.remote, "show", "main:profile.json"]));
  assert.equal(profile.settings.packages[0].source, "npm:@fixture/pi-sync-extension@1.0.0");
  assert.deepEqual(profile.settings.packages[0].skills, []);
  assert.equal(profile.settings.packages[1], `${gitSource}@${commit}`);
  assert.ok(!profile.files.some((file: any) => file.path.includes("node_modules")));
  const target = harness(f.target, execute); await target.command(`setup "${f.remote}"`);
  assert.match(await target.command("restore"), /还原成功/);
  const settings = await parsed(join(f.target, "settings.json"));
  const manager = new DefaultPackageManager({ cwd: f.target, agentDir: f.target, settingsManager: SettingsManager.inMemory(settings) });
  const npmInstalled = manager.getInstalledPath(settings.packages[0].source, "user")!;
  assert.equal((await parsed(join(npmInstalled, "package.json"))).version, "1.0.0");
  assert.equal(await f.git(["-C", manager.getInstalledPath(settings.packages[1], "user")!, "rev-parse", "HEAD"]), commit);
  assert.equal(await exists(join(f.target, "extensions", "local", "node_modules", "@fixture", "tiny", "index.js")), true);

  const notices: string[] = [];
  const settingsManager = SettingsManager.create(f.directory, f.target);
  const loader = new DefaultResourceLoader({ cwd: f.directory, agentDir: f.target, settingsManager, noSkills: true, disabledBuiltinExtensions: ["mcp"],
    extensionFactories: [(pi) => piSync(pi, { agentDir: f.target, run: execute })] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: f.directory, agentDir: f.target, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(f.directory) });
  try {
    await session.bindExtensions({ mode: "rpc", uiContext: { notify: (message: string) => { notices.push(message); } } as unknown as ExtensionUIContext });
    for (const command of ["fixture-npm", "fixture-git", "fixture-local"]) await session.prompt(`/${command}`);
    assert.deepEqual(notices.slice(-3), ["npm fixture 1.0.0", "git fixture fixed commit", "local dependency works"]);
  } finally { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
  if (process.platform === "win32") {
    await t.test("the installed Bun path rebuilds packages without a parent Node preflight", async () => {
      const bunAgent = join(f.directory, "bun-agent");
      await mkdir(bunAgent);
      await json(join(bunAgent, "settings.json"), { npmCommand: ["bun"] });
      const bunRun: Run = (command, args, options) => {
        if (command === "node") throw new Error("Bun package path must not require a separate Node preflight");
        return execute(command, args, options);
      };
      const bunTarget = harness(bunAgent, bunRun, { pi: "pi.exe" });
      await bunTarget.command(`setup "${f.remote}"`);
      assert.match(await bunTarget.command("restore"), /还原成功/);
      assert.equal((await parsed(join(bunAgent, "npm", "node_modules", "@fixture", "pi-sync-extension", "package.json"))).version, "1.0.0");
      assert.equal(await exists(join(bunAgent, "npm", "node_modules", "@earendil-works", "pi-coding-agent")), false, "host peer was duplicated instead of supplied by Pi");
      assert.equal(await exists(join(bunAgent, "extensions", "local", "node_modules", "@fixture", "tiny", "index.js")), true);
    });
  }
  const sourceSettings = await parsed(join(f.source, "settings.json"));
  const sourceManager = new DefaultPackageManager({ cwd: f.source, agentDir: f.source, settingsManager: SettingsManager.inMemory(sourceSettings) });
  await text(join(sourceManager.getInstalledPath(gitSource, "user")!, "index.ts"), "// an uncommitted source edit\n");
  await assert.rejects(source.command("save"), /Git 扩展含本机修改/);
});

test("package preparation failures and missing runtime do not replace target settings", async (t) => {
  const f = await fixture(t);
  await json(join(f.source, "settings.json"), { packages: ["npm:@fixture/fail"] });
  await json(join(f.source, "npm", "node_modules", "@fixture", "fail", "package.json"), { name: "@fixture/fail", version: "1.0.0" });
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`); await a.command("save");
  const b = harness(f.target, f.execute); await b.command(`setup "${f.remote}"`);
  await json(join(f.target, "settings.json"), { theme: "must stay" });
  for (const [stderr, hint] of [["ETARGET No matching version found for fixture", /版本是否存在/], ["npm error E401 Unable to authenticate", /registry.*认证配置/s], ["npm error ENOSPC", /磁盘空间/], ["npm error ENOTFOUND", /DNS/]] as const) {
    const failing: Run = async (command, args, options) => args.includes("install") && args.includes("npm:@fixture/fail@1.0.0")
      ? { code: 1, stdout: "", stderr } : f.execute(command, args, options);
    await assert.rejects(harness(f.target, failing).command("restore"), hint);
    assert.deepEqual(await parsed(join(f.target, "settings.json")), { theme: "must stay" });
  }
  const oldNode: Run = async (command, args, options) => command === "node" && args.includes("--version") ? { code: 0, stdout: "v18.19.1", stderr: "" } : f.execute(command, args, options);
  await assert.rejects(harness(f.target, oldNode).command("restore"), /Node\.js 22\.19/);
  assert.deepEqual(await parsed(join(f.target, "settings.json")), { theme: "must stay" });
});
