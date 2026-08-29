import assert from "node:assert/strict";
import { basename } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createWindowsToastExtension } from "../src/index.ts";

interface ExecCall {
  command: string;
  args: string[];
  options?: { timeout?: number };
}

interface HarnessOptions {
  platform?: NodeJS.Platform;
  mode?: string;
  cwd?: string;
  exec?: (command: string, args: string[], options?: { timeout?: number }) => Promise<unknown>;
}

interface Harness {
  handler: (event: object, ctx: ExtensionContext) => Promise<void>;
  ctx: ExtensionContext;
  calls: ExecCall[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const handlers = new Map<string, (event: object, ctx: ExtensionContext) => Promise<void>>();
  const calls: ExecCall[] = [];
  const exec = options.exec ?? (async (command: string, args: string[]) => {
    return { stdout: "", stderr: "", code: 0, killed: false };
  });
  const effectiveExec = async (
    command: string,
    args: string[],
    execOptions?: { timeout?: number },
  ) => {
    calls.push({ command, args, options: execOptions });
    return exec(command, args, execOptions);
  };

  const fakePi = {
    on: (event: string, handler: (event: object, ctx: ExtensionContext) => Promise<void>) => {
      handlers.set(event, handler);
    },
    exec: effectiveExec,
  } as unknown as ExtensionAPI;

  createWindowsToastExtension(fakePi, { platform: options.platform });

  const handler = handlers.get("agent_settled");
  assert.ok(handler);

  return {
    handler,
    ctx: { mode: options.mode ?? "tui", cwd: options.cwd ?? process.cwd() } as unknown as ExtensionContext,
    calls,
  };
}

function decodeCommandText(command: string, index: number): string {
  const matches = [...command.matchAll(/FromBase64String\('([^']+)'\)/g)];
  assert.ok(matches[index]);
  return Buffer.from(matches[index]?.[1] ?? "", "base64").toString("utf8");
}

test("Windows TUI settlement requests one Toast with the fixed content", async () => {
  const harness = createHarness({ cwd: "D:\\work\\pi-plugins" });
  await harness.handler({ type: "agent_settled" }, harness.ctx);

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0]?.command, "powershell.exe");
  assert.deepEqual(harness.calls[0]?.args.slice(0, 3), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
  ]);
  assert.ok(harness.calls[0]?.args[3]);

  const script = harness.calls[0]?.args[3] ?? "";
  assert.ok(
    script.includes(
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    ),
  );
  assert.equal(decodeCommandText(script, 0), "Task completed \u00b7 pi-plugins");
  assert.ok(script.includes("ToastTemplateType]::ToastText01"));
  assert.ok(script.includes("CreateToastNotifier('Pi')"));
});

test("every settlement emits its own independent Toast", async () => {
  const harness = createHarness({ cwd: "D:\\work\\project-a" });
  await harness.handler({ type: "agent_settled" }, harness.ctx);
  await harness.handler({ type: "agent_settled" }, harness.ctx);

  assert.equal(harness.calls.length, 2);
  assert.ok(harness.calls.every((call) => call.command === "powershell.exe"));
  assert.ok(harness.calls.every((call) => decodeCommandText(call.args[3] ?? "", 0) === "Task completed \u00b7 project-a"));
});

test("non-Windows platforms and non-TUI modes stay inert", async () => {
  for (const platform of ["linux", "darwin"] as const) {
    const harness = createHarness({ platform, mode: "tui" });
    await harness.handler({ type: "agent_settled" }, harness.ctx);
    assert.equal(harness.calls.length, 0, platform);
  }

  for (const mode of ["rpc", "json", "print"]) {
    const harness = createHarness({ platform: "win32", mode });
    await harness.handler({ type: "agent_settled" }, harness.ctx);
    assert.equal(harness.calls.length, 0, mode);
  }
});

test("PowerShell-sensitive directory basename stays safe and visible", async () => {
  const cwd = "D:\\tmp\\project;$(danger) & <tag> 'quote' \"dquote\" \u4e2d\u6587 \u00b7";
  const harness = createHarness({ cwd });
  await harness.handler({ type: "agent_settled" }, harness.ctx);

  assert.equal(harness.calls.length, 1);
  const script = harness.calls[0]?.args[3] ?? "";
  assert.ok(!script.includes(basename(cwd)));
  assert.equal(decodeCommandText(script, 0), `Task completed \u00b7 ${basename(cwd)}`);
});

test("Toast failures are contained and never trigger another path", async () => {
  for (const failure of [
    async () => {
      throw new Error("powershell unavailable");
    },
    async () => ({ stdout: "", stderr: "failed", code: 1, killed: false }),
  ]) {
    const harness = createHarness({ exec: failure });
    await harness.handler({ type: "agent_settled" }, harness.ctx);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0]?.command, "powershell.exe");
  }
});
