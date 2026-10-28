import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { TestContext } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import piSync from "../src/index.ts";
import { run, type Run } from "../src/io.ts";

export const GIT_ENV = { GIT_AUTHOR_NAME: "Pi Sync Test", GIT_AUTHOR_EMAIL: "pi-sync@example.invalid", GIT_COMMITTER_NAME: "Pi Sync Test", GIT_COMMITTER_EMAIL: "pi-sync@example.invalid", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false" };

export async function fixture(t?: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "pi-sync-test-"));
  const source = join(directory, "source-agent");
  const target = join(directory, "target-agent");
  const remote = join(directory, "remote.git");
  const home = join(directory, "home");
  await mkdir(source); await mkdir(target); await mkdir(home);
  const execute: Run = (command, args, options) => run(command, args, { ...options, env: { ...options.env, ...GIT_ENV, GIT_CONFIG_GLOBAL: join(directory, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
    HOME: home, USERPROFILE: home, NPM_CONFIG_USERCONFIG: join(home, "npmrc") } });
  const git = async (args: string[], cwd = directory) => {
    const result = await execute("git", args, { cwd });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.trim();
  };
  await git(["init", "--bare", "--initial-branch=main", remote]);
  const cleanup = async () => {
    const base = resolve(tmpdir()) + sep;
    assert.ok(resolve(directory).startsWith(base));
    assert.ok(directory.includes("pi-sync-test-"));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  t?.after(cleanup);
  return { directory, source, target, remote, execute, git, cleanup };
}

export async function json(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}
export async function text(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
export async function parsed(path: string) { return JSON.parse(await readFile(path, "utf8")); }

export function harness(agentDir: string, execute: Run, extra: Partial<Parameters<typeof piSync>[1]> = {}) {
  const notices: string[] = [];
  let handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let shutdown: () => Promise<void>;
  const pi = {
    registerCommand(name: string, definition: { handler: typeof handler }) { assert.equal(name, "sync"); handler = definition.handler; },
    on(name: string, callback: typeof shutdown) { assert.equal(name, "session_shutdown"); shutdown = callback; },
  } as unknown as ExtensionAPI;
  const ctx = { cwd: agentDir, mode: "print", hasUI: false, isIdle: () => true, hasPendingMessages: () => false,
    ui: { notify() { throw new Error("UI must be guarded"); } } } as unknown as ExtensionCommandContext;
  piSync(pi, { agentDir, version: "1.4.0", run: execute, report: (message) => notices.push(message), ...extra });
  return { notices, ctx, command: async (args: string) => { await handler!(args, ctx); return notices.at(-1)!; }, shutdown: async () => shutdown!() };
}
