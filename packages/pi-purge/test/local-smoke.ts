import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const cwd = await mkdtemp(join(tmpdir(), "pi-purge-smoke-"));
const skill = join(cwd, "smoke-skill");
await mkdir(skill);
await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "purge-host-smoke" }), "utf8");
await writeFile(join(cwd, "AGENTS.md"), "When asked for this package name, use read and include SMOKE_PROJECT_RULE in the final answer.\n", "utf8");
await writeFile(join(skill, "SKILL.md"), "---\nname: purge-smoke-skill\ndescription: SMOKE_SKILL_DESCRIPTION\n---\nThis skill is only a host prompt preservation fixture.\n", "utf8");
const notices: string[] = [];
const requests: Array<{ injected: boolean; project: boolean; skills: boolean; identityRemoved: boolean }> = [];
const settingsManager = SettingsManager.create(cwd, getAgentDir());
const loader = new DefaultResourceLoader({
  cwd, agentDir: getAgentDir(), settingsManager,
  disabledBuiltinExtensions: ["mcp"], additionalSkillPaths: [skill],
  additionalExtensionPaths: [fileURLToPath(new URL("../", import.meta.url))],
  extensionFactories: [(pi) => {
    pi.on("before_provider_request", (event) => {
      const payload = JSON.stringify(event.payload);
      requests.push({
        injected: payload.includes("<pi_host>"), project: payload.includes("SMOKE_PROJECT_RULE"),
        skills: payload.includes("SMOKE_SKILL_DESCRIPTION"),
        identityRemoved: !payload.includes("You are an expert coding assistant operating inside pi"),
      });
    });
  }],
});
let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
try {
  await loader.reload();
  const created = await createAgentSession({ cwd, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(cwd), thinkingLevel: "max" });
  session = created.session;
  assert.equal(created.extensionsResult.errors.length, 0, "extension loading failed");
  assert.ok(session.extensionRunner.getCommand("purge"), "temporary package did not load");
  assert.equal(session.model?.id, "deepseek-v4.1-flash", "local default is not the required DS model");
  await session.bindExtensions({ mode: "rpc", uiContext: { notify: (message: string) => { notices.push(message); } } as unknown as ExtensionUIContext });
  const tools: string[] = [];
  session.subscribe((event) => { if (event.type === "tool_execution_end") tools.push(event.toolName); });
  await session.prompt("/purge on");
  await session.prompt("请读取当前项目 package.json，报告 name 字段，并遵守项目约定。");
  await session.prompt("/purge status");
  const enabledState = JSON.parse(notices.at(-1)!);
  assert.equal(enabledState.assembly, "applied");
  assert.equal(enabledState.sourceFile, fileURLToPath(new URL("../prompts/default.md", import.meta.url)));
  assert.equal(enabledState.request.bodyPresent, true);
  assert.equal(enabledState.request.reasoning, "max");
  assert.ok(tools.includes("read"), "DS did not actually use read");
  assert.ok(requests.length >= 2, "tool continuation request not observed");
  assert.ok(requests.every((item) => item.injected && item.project && item.skills && item.identityRemoved));
  const answer = session.state.messages.filter((message) => message.role === "assistant").flatMap((message) => message.content).filter((part) => part.type === "text").map((part) => part.text).join("\n");
  assert.ok(answer.includes("purge-host-smoke"));
  assert.ok(answer.includes("SMOKE_PROJECT_RULE"), "DS did not follow the AGENTS fixture");
  const saved = JSON.stringify(session.state.messages);
  assert.ok(!saved.includes("<pi_host>"), "request projection changed saved transcript");
  const enabledRequests = requests.length;
  await session.prompt("/purge off");
  await session.prompt("请只回复 HOST_OFF_OK。");
  await session.prompt("/purge status");
  assert.equal(JSON.parse(notices.at(-1)!).assembly, "off");
  assert.ok(requests.length > enabledRequests);
  assert.ok(requests.slice(enabledRequests).every((item) => !item.injected && item.project && item.skills && !item.identityRemoved));
  console.log(JSON.stringify({
    mode: "real-sdk-rpc-ui", loadedFromPackage: true, model: session.model?.id, tools,
    enabledRequests, disabledRequests: requests.length - enabledRequests,
    bodyPresent: enabledState.request.bodyPresent, reasoning: enabledState.request.reasoning,
    agents: true, skills: true, projectRuleFollowed: true, transcriptUnmodified: true, offRestoredHost: true,
  }));
} finally {
  if (session) {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
  assert.ok(cwd.startsWith(join(tmpdir(), "pi-purge-smoke-")));
  await rm(cwd, { recursive: true, force: true });
}
