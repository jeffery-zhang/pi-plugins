import assert from "node:assert/strict";
import { readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { exists, run, type Run } from "../src/io.ts";
import { fixture, harness, json, parsed, text } from "./harness.ts";

const SECRET = "ACTUAL_API_KEY_NEVER_EXPORT_12345";

test("public commands: empty repository, native configuration roundtrip, local authentication, resources and history", { timeout: 90_000 }, async (t) => {
  const f = await fixture(t);
  await json(join(f.source, "settings.json"), { defaultProvider: "example", defaultModel: "model-a", enabledModels: ["example/model-a"], theme: "dark", shellPath: "SOURCE_SHELL", lastChangelogVersion: "source-only" });
  await json(join(f.source, "models.json"), { providers: { example: { api: "openai-responses", baseUrl: "https://example.invalid/v1", apiKey: SECRET,
    headers: { Authorization: SECRET, "X-Custom": "non-secret" }, models: [{ id: "model-a", name: "中文模型", contextWindow: 100000 }] } } });
  await json(join(f.source, "mcp.json"), { mcpServers: { docs: { url: "https://example.invalid/mcp", env: { API_KEY: SECRET, SAFE_REF: "${MCP_KEY}" }, oauth: { clientSecret: SECRET } } } });
  await text(join(f.source, "auth.json"), SECRET);
  await text(join(f.source, "extensions", "helper.ts"), 'export default function() {}\n');
  await text(join(f.source, "agents", "worker.md"), "worker instructions\n");
  await text(join(f.source, "prompts", "task.md"), "Arbitrary text is not scanned: token=keep-this-text\n");
  await json(join(f.source, "prompts", "data.json"), [{ id: "example", value: "JSON resource arrays are supported" }]);
  await json(join(f.source, "prompts", "schema.json"), { dependencies: { token: "1.0.0" }, scripts: { token: "echo keep" }, privateKey: { d: SECRET }, providers: { token: { apiKey: SECRET, name: "keep-provider-id" }, env: { apiKey: SECRET, name: "keep-env-id" } } });
  await text(join(f.source, "extensions", ".env"), SECRET);
  await text(join(f.source, "sessions", "history.jsonl"), "must not export");
  const source = harness(f.source, f.execute);
  assert.match(await source.command(`setup "${f.remote}"`), /可读取.*尚无快照/s);
  await assert.rejects(source.command("restore"), /还没有环境快照/);
  assert.match(await source.command("save"), /保存成功/);
  const first = await f.git(["--git-dir", f.remote, "rev-parse", "main"]);
  const profile = JSON.parse(await f.git(["--git-dir", f.remote, "show", "main:profile.json"]));
  assert.equal(profile.settings.shellPath, undefined);
  assert.equal(profile.settings.lastChangelogVersion, undefined);
  assert.equal(profile.models.providers.example.apiKey, undefined);
  assert.ok(!JSON.stringify(profile).includes(SECRET));
  assert.ok(profile.files.some((file: any) => file.path === "agents/worker.md"));
  assert.ok(!profile.files.some((file: any) => /auth\.json|\.env|sessions/.test(file.path)));
  assert.match(Buffer.from(profile.files.find((file: any) => file.path === "prompts/task.md").content, "base64").toString(), /token=keep-this-text/);
  await json(join(f.target, "settings.json"), { defaultProvider: "old", defaultModel: "old", theme: "light", shellPath: "TARGET_SHELL", lastChangelogVersion: "target-only" });
  await json(join(f.target, "models.json"), { providers: { example: { baseUrl: "https://old.invalid", apiKey: "TARGET_KEY", headers: { Authorization: "TARGET_HEADER" }, models: [] }, removed: { api: "openai-completions", apiKey: "REMOVED_KEY" }, token: { apiKey: "TOKEN_PROVIDER_TO_REMOVE" } } });
  await json(join(f.target, "prompts", "schema.json"), { providers: { token: { name: "old", apiKey: "LOCAL_TOKEN_PROVIDER" }, env: { name: "old", apiKey: "LOCAL_ENV_PROVIDER" } } });
  await text(join(f.target, "auth.json"), "TARGET_AUTH_UNTOUCHED");
  await text(join(f.target, "extensions", "obsolete.ts"), "old extension");
  await text(join(f.target, "extensions", ".env"), "TARGET_ENV_UNTOUCHED");
  await text(join(f.target, "outside.txt"), "not managed");
  const target = harness(f.target, f.execute);
  await target.command(`setup "${f.remote}"`);
  const restored = await target.command("restore");
  assert.match(restored, /待鉴权.*待重启/s);
  const settings = await parsed(join(f.target, "settings.json"));
  assert.equal(settings.defaultModel, "model-a"); assert.equal(settings.theme, "dark");
  assert.equal(settings.shellPath, "TARGET_SHELL"); assert.equal(settings.lastChangelogVersion, "target-only");
  const models = await parsed(join(f.target, "models.json"));
  assert.equal(models.providers.example.baseUrl, "https://example.invalid/v1");
  assert.equal(models.providers.example.apiKey, "TARGET_KEY");
  assert.equal(models.providers.example.headers.Authorization, "TARGET_HEADER");
  assert.equal(models.providers.example.models[0].name, "中文模型");
  assert.equal(models.providers.removed, undefined);
  assert.equal(models.providers.token, undefined);
  assert.equal(await readFile(join(f.target, "auth.json"), "utf8"), "TARGET_AUTH_UNTOUCHED");
  assert.equal(await readFile(join(f.target, "extensions", ".env"), "utf8"), "TARGET_ENV_UNTOUCHED");
  assert.equal(await exists(join(f.target, "extensions", "obsolete.ts")), false);
  assert.equal(await readFile(join(f.target, "agents", "worker.md"), "utf8"), "worker instructions\n");
  assert.deepEqual(await parsed(join(f.target, "prompts", "data.json")), [{ id: "example", value: "JSON resource arrays are supported" }]);
  assert.deepEqual(await parsed(join(f.target, "prompts", "schema.json")), { dependencies: { token: "1.0.0" }, scripts: { token: "echo keep" }, providers: { token: { name: "keep-provider-id", apiKey: "LOCAL_TOKEN_PROVIDER" }, env: { name: "keep-env-id", apiKey: "LOCAL_ENV_PROVIDER" } } });
  assert.equal(await readFile(join(f.target, "outside.txt"), "utf8"), "not managed");
  const last = await parsed(join(f.target, "sync", "last-restore.json"));
  const backupModels = await parsed(join(f.target, "sync", "backups", last.backup, "original", "models.json"));
  assert.equal(backupModels.providers.removed.apiKey, "REMOVED_KEY");
  assert.equal(await exists(join(f.target, "sync", "active.json")), false);
  await source.command("save");
  const second = await f.git(["--git-dir", f.remote, "rev-parse", "main"]);
  assert.notEqual(second, first);
  assert.equal(await f.git(["--git-dir", f.remote, "rev-parse", "main^"]), first);
});

test("environment references, explicit custom config and local paths survive the right side of the boundary", async (t) => {
  const f = await fixture(t);
  await json(join(f.source, "models.json"), { providers: { endpoint: { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "$PROVIDER_KEY", models: [] } } });
  await json(join(f.source, "pi-fff.json"), { mode: "replace", historyDbPath: "SOURCE_DB", apiKey: SECRET });
  await json(join(f.target, "pi-fff.json"), { mode: "old", historyDbPath: "TARGET_DB", apiKey: "TARGET_SECRET" });
  const a = harness(f.source, f.execute);
  await a.command(`setup "${f.remote}"`); await a.command("include pi-fff.json"); await a.command("save");
  const b = harness(f.target, f.execute);
  await b.command(`setup "${f.remote}"`); await b.command("restore");
  assert.equal((await parsed(join(f.target, "models.json"))).providers.endpoint.apiKey, "$PROVIDER_KEY");
  assert.deepEqual(await parsed(join(f.target, "pi-fff.json")), { mode: "replace", apiKey: "TARGET_SECRET", historyDbPath: "TARGET_DB" });
  await assert.rejects(a.command("include ../outside"), /非法|相对路径/);
  await assert.rejects(a.command("include auth.json"), /不能作为/);
  await assert.rejects(a.command("include sync/backups"), /不能作为/);
});

test("invalid remote snapshot, escaping paths and hashes never modify the target", async (t) => {
  const f = await fixture(t);
  await json(join(f.source, "settings.json"), { theme: "dark" });
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`); await a.command("save");
  const b = harness(f.target, f.execute); await b.command(`setup "${f.remote}"`);
  await json(join(f.target, "settings.json"), { theme: "local" });
  let mode = "path";
  const injected: Run = async (command, args, options) => {
    const result = await f.execute(command, args, options);
    if (args.includes("show") && args.some((arg) => arg.endsWith(":profile.json"))) {
      const profile = JSON.parse(result.stdout);
      if (mode === "path") profile.roots = ["../escape"];
      if (mode === "hash") { profile.roots = ["prompts"]; profile.files = [{ path: "prompts/a.md", content: "YQ==", sha256: "bad", executable: false }]; }
      if (mode === "version") profile.format = 999;
      return { ...result, stdout: JSON.stringify(profile) };
    }
    return result;
  };
  const broken = harness(f.target, injected);
  for (mode of ["path", "hash", "version"]) {
    await assert.rejects(broken.command("restore"), /非法|校验|不支持/);
    assert.deepEqual(await parsed(join(f.target, "settings.json")), { theme: "local" });
    assert.equal(await exists(join(f.target, "sync", "active.json")), false);
  }
});

test("symlink roots are rejected before reading outside the Agent Directory", async (t) => {
  const f = await fixture(t);
  await text(join(f.directory, "external", "private.txt"), SECRET);
  await symlink(join(f.directory, "external"), join(f.source, "prompts"), process.platform === "win32" ? "junction" : "dir");
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`);
  await assert.rejects(a.command("save"), /符号链接|junction/);
  assert.ok(a.notices.every((message) => !message.includes(SECRET)));
});

test("unsupported versions, argument errors, missing Git, network ambiguity and no UI errors are explicit", async (t) => {
  const f = await fixture(t);
  for (const version of ["0.84.3", "1.5.0", "1.4.0-beta"]) {
    const h = harness(f.source, f.execute, { version });
    await assert.rejects(h.command(`setup "${f.remote}"`), /需要 Pi 1\.4\.x/);
  }
  const good = harness(f.source, f.execute, { version: "1.4.19" });
  await good.command(`setup "${f.remote}"`);
  await assert.rejects(good.command('setup "unfinished'), /引号未闭合/);
  await assert.rejects(good.command("setup"), /参数数量/);
  await assert.rejects(good.command("save extra"), /参数数量/);
  const missing = harness(f.source, f.execute, { git: "pi-sync-does-not-exist-12345" });
  await assert.rejects(missing.command("status"), /找不到或无法执行.*PATH/s);
  const inaccessible: Run = async (command, args, options) => args.includes("ls-remote")
    ? { stdout: "", stderr: "fatal: repository not found", code: 128 } : f.execute(command, args, options);
  const bad = harness(f.source, inaccessible);
  await assert.rejects(bad.command("status"), /不存在.*无权限/s);
  assert.match(bad.notices.at(-1)!, /阶段.*影响.*备份.*处理/s);
});

test("apply failures roll back files and retain the original failure stage", async (t) => {
  const f = await fixture(t);
  await json(join(f.source, "settings.json"), { theme: "new" });
  await json(join(f.source, "models.json"), { providers: {} });
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`); await a.command("save");
  const b = harness(f.target, f.execute); await b.command(`setup "${f.remote}"`);
  await json(join(f.target, "settings.json"), { theme: "old" });
  let failed = false;
  const bad = harness(f.target, f.execute, { rename: async (from, to) => {
    if (!failed && String(from).includes("staging") && String(to) === join(f.target, "models.json")) { failed = true; throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" }); }
    return rename(from, to);
  } });
  await assert.rejects(bad.command("restore"), /ENOSPC.*已回退/s);
  assert.deepEqual(await parsed(join(f.target, "settings.json")), { theme: "old" });
  assert.equal(await exists(join(f.target, "models.json")), false);
  assert.equal(await exists(join(f.target, "sync", "active.json")), false);
  assert.match(bad.notices.at(-1)!, /应用受管文件.*磁盘空间/s);
});

test("rollback failures preserve a recoverable journal and recover works through the public command", async (t) => {
  const f = await fixture(t);
  await json(join(f.source, "settings.json"), { theme: "new" });
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`); await a.command("save");
  const b = harness(f.target, f.execute); await b.command(`setup "${f.remote}"`);
  await json(join(f.target, "settings.json"), { theme: "old" });
  const bad = harness(f.target, f.execute, { rename: async (from, to) => {
    if (String(from).includes("staging") && String(to) === join(f.target, "sync", "config.json")) throw new Error("fixture apply failure");
    if (String(from).includes("original")) throw new Error("fixture rollback failure");
    return rename(from, to);
  } });
  await assert.rejects(bad.command("restore"), /回退也失败/);
  assert.equal(await exists(join(f.target, "sync", "active.json")), true);
  await assert.rejects(b.command("save"), /上次还原中断/);
  assert.match(await harness(f.target, f.execute, { git: "pi-sync-missing-git" }).command("recover"), /已回退/);
  assert.deepEqual(await parsed(join(f.target, "settings.json")), { theme: "old" });
  assert.equal(await exists(join(f.target, "sync", "active.json")), false);
});

test("backup failure prevents any target configuration replacement", async (t) => {
  const f = await fixture(t);
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`); await a.command("save");
  const b = harness(f.target, f.execute); await b.command(`setup "${f.remote}"`);
  await json(join(f.target, "settings.json"), { theme: "old" });
  const bad = harness(f.target, f.execute, { rename: async (from, to) => {
    if (String(to).includes("original")) throw new Error("fixture backup failure");
    return rename(from, to);
  } });
  await assert.rejects(bad.command("restore"), /fixture backup failure/);
  assert.deepEqual(await parsed(join(f.target, "settings.json")), { theme: "old" });
});

test("save races preserve both clients' commits without merging profile content", async (t) => {
  const f = await fixture(t);
  await json(join(f.source, "settings.json"), { theme: "source" });
  await json(join(f.target, "settings.json"), { theme: "target" });
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`); await a.command("save");
  let injected = false;
  const raced: Run = async (command, args, options) => {
    if (!injected && args.includes("push")) { injected = true; await a.command("save"); }
    return f.execute(command, args, options);
  };
  const b = harness(f.target, raced); await b.command(`setup "${f.remote}"`);
  await b.command("save");
  assert.equal(await f.git(["--git-dir", f.remote, "rev-list", "--count", "main"]), "3");
  const profile = JSON.parse(await f.git(["--git-dir", f.remote, "show", "main:profile.json"]));
  assert.equal(profile.settings.theme, "target");
});

test("a lost push receipt is verified instead of blindly reporting failure", async (t) => {
  const f = await fixture(t);
  const lost: Run = async (command, args, options) => {
    const result = await f.execute(command, args, options);
    if (args.includes("push") && result.code === 0) throw new Error("fixture connection dropped after acceptance");
    return result;
  };
  const a = harness(f.source, lost); await a.command(`setup "${f.remote}"`);
  assert.match(await a.command("save"), /已确认远端 commit/);
  assert.equal(await f.git(["--git-dir", f.remote, "rev-list", "--count", "main"]), "1");
});

test("unknown push result is honest and status exposes the pending commit", async (t) => {
  const f = await fixture(t);
  let pushed = false;
  const lost: Run = async (command, args, options) => {
    if (pushed && args.includes("ls-remote")) throw new Error("fixture DNS unavailable");
    const result = await f.execute(command, args, options);
    if (args.includes("push")) { pushed = true; throw new Error("fixture disconnect"); }
    return result;
  };
  const a = harness(f.source, lost); await a.command(`setup "${f.remote}"`);
  await assert.rejects(a.command("save"), /远端结果未知/);
  const status = await harness(f.source, f.execute).command("status");
  assert.match(status, /已确认远端当前为该 commit/);
});

test("operation reentry, cancellation and shutdown stop later work and release locks", async (t) => {
  const f = await fixture(t);
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  let intercept = false;
  const waiting: Run = async (command, args, options) => {
    if (intercept && args.includes("ls-remote")) {
      started();
      await new Promise<void>((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(new Error("fixture aborted")), { once: true }));
    }
    return f.execute(command, args, options);
  };
  const a = harness(f.source, waiting); await a.command(`setup "${f.remote}"`);
  intercept = true;
  const pending = a.command("save");
  const rejected = assert.rejects(pending, /fixture aborted/);
  await entered;
  await assert.rejects(a.command("status"), /已有同步操作/);
  await a.command("cancel");
  await a.shutdown(); await rejected;
  assert.equal(await exists(join(f.source, "sync", "operation.lock")), false);
});

test("stale process locks are recoverable while live process locks are not stolen", async (t) => {
  const f = await fixture(t);
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`);
  await json(join(f.source, "sync", "operation.lock"), { pid: process.pid });
  await assert.rejects(a.command("status"), /已有同步操作正在运行/);
  await json(join(f.source, "sync", "operation.lock"), { pid: 2_000_000_000 });
  assert.match(await a.command("status"), /Pi Sync/);
});

test("the actual process runner supports timeout, missing commands and Unicode output", async (t) => {
  const f = await fixture(t);
  await assert.rejects(run("pi-sync-command-that-is-missing", [], { cwd: f.directory }), /找不到/);
  await assert.rejects(run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: f.directory, timeout: 50 }), /超时/);
  const output = await run(process.execPath, ["-e", "process.stdout.write('中文'.repeat(100000))"], { cwd: f.directory });
  assert.ok(output.stdout === "中文".repeat(100000), "UTF-8 output changed across process chunks");
});

test("continuous remote races stop after three attempts and preserve remote history", async (t) => {
  const f = await fixture(t);
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`); await a.command("save");
  let pushes = 0;
  const racing: Run = async (command, args, options) => {
    if (args.includes("push")) { pushes++; await a.command("save"); }
    return f.execute(command, args, options);
  };
  const b = harness(f.target, racing); await b.command(`setup "${f.remote}"`);
  await assert.rejects(b.command("save"), /三次保存尝试均未完成/);
  assert.equal(pushes, 3);
  assert.equal(await f.git(["--git-dir", f.remote, "rev-list", "--count", "main"]), "4");
});

test("cancelling an in-progress application rolls back through the public command", async (t) => {
  const f = await fixture(t);
  await json(join(f.source, "settings.json"), { theme: "new" });
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`); await a.command("save");
  const normal = harness(f.target, f.execute); await normal.command(`setup "${f.remote}"`);
  await json(join(f.target, "settings.json"), { theme: "old" });
  let cancelled = false;
  let b: ReturnType<typeof harness>;
  b = harness(f.target, f.execute, { rename: async (from, to) => {
    if (!cancelled && String(from).includes("staging")) { cancelled = true; await b.command("cancel"); }
    return rename(from, to);
  } });
  await assert.rejects(b.command("restore"), /已取消.*已回退/s);
  assert.deepEqual(await parsed(join(f.target, "settings.json")), { theme: "old" });
  assert.equal(await exists(join(f.target, "sync", "active.json")), false);
});

test("untrusted recovery entries cannot touch independent credentials", async (t) => {
  const f = await fixture(t);
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`);
  await text(join(f.source, "auth.json"), "leave-credentials-alone");
  const id = "00000000-0000-0000-0000-000000000000";
  await json(join(f.source, "sync", "active.json"), { id, stage: `staging/${id}`, roots: ["prompts"], state: "applying", entries: [{ path: "auth.json", staged: null, old: true }] });
  await assert.rejects(a.command("recover"), /受管范围外/);
  assert.equal(await readFile(join(f.source, "auth.json"), "utf8"), "leave-credentials-alone");
  assert.equal(await exists(join(f.source, "sync", "active.json")), true);
});

test("network diagnostics mask known URL credentials even when used as a username", async (t) => {
  const f = await fixture(t);
  const failing: Run = async (command, args, options) => args.includes("ls-remote")
    ? { code: 128, stdout: "", stderr: "failed https://FAKE_CREDENTIAL@example.invalid/repo" } : f.execute(command, args, options);
  const a = harness(f.source, failing);
  await assert.rejects(a.command(`setup "${f.remote}"`));
  assert.ok(!a.notices.join("\n").includes("FAKE_CREDENTIAL"));
  assert.match(a.notices.at(-1)!, /已屏蔽/);
});

test("timing out the actual process tree prevents a descendant's delayed write", async (t) => {
  const f = await fixture(t);
  const marker = join(f.directory, "must-not-be-written.txt");
  const descendant = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late-write'), 800)`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'ignore'});setInterval(()=>{},1000)`;
  await assert.rejects(run(process.execPath, ["-e", parent], { cwd: f.directory, timeout: 150 }), /超时/);
  await new Promise((done) => setTimeout(done, 1000));
  assert.equal(await exists(marker), false);
});

test("native Windows script shims reject unsafe batch wrappers and preserve argument data", { skip: process.platform !== "win32" }, async (t) => {
  const f = await fixture(t);
  const script = join(f.directory, "argv.cjs");
  const command = join(f.directory, "argv.cmd");
  await text(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
  await text(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  const args = ["space value", "中文", "semi;$(echo no)", 'literal"quote', "%PI_SYNC_TEST_VAR%", "a&echo PI_SYNC_BAD"];
  await assert.rejects(run(command, args, { cwd: f.directory }), /无法安全运行/);
  await text(command.replace(/\.cmd$/, ".ps1"), `& "${process.execPath}" "${script}" $args\n`);
  const result = await run(command, args, { cwd: f.directory, env: { PI_SYNC_TEST_VAR: "must-not-expand" } });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("malformed JSON and invalid UTF-8 fail without echoing configuration content", async (t) => {
  const f = await fixture(t);
  const a = harness(f.source, f.execute); await a.command(`setup "${f.remote}"`);
  await text(join(f.source, "models.json"), `{ "apiKey": "${SECRET}", invalid`);
  await assert.rejects(a.command("save"), /JSON 或 UTF-8 格式无效/);
  assert.ok(!a.notices.join("\n").includes(SECRET));
  await writeFile(join(f.source, "models.json"), Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
  await assert.rejects(a.command("save"), /UTF-8 格式无效/);
});
