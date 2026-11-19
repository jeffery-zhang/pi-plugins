import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const packageRoot = process.cwd();
const repo = join(packageRoot, "..", "..");
const agentDir = await mkdtemp(join(tmpdir(), "pi-prompt-replace-agent-"));
let requestBody: any;
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const payload = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "LOCAL_PROMPT_REPLACE_OK" }, finish_reason: null }] })}`,
    "",
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
    "",
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}`,
    "",
    "data: [DONE]",
    "",
    "",
  ].join("\n");
  response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
  response.end(payload);
});

try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await writeFile(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      muryo: {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: "openai-completions",
        apiKey: "test",
        models: [{ id: "gemini-4-hydrogen-sonar", name: "Gemini 4 Hydrogen Sonar", reasoning: true, input: ["text"] }],
      },
    },
  }), "utf8");

  const child = spawn("pi", [
    "--no-extensions", "-e", packageRoot,
    "--model", "muryo/gemini-4-hydrogen-sonar", "--thinking", "high",
    "--print", "--no-session", "--no-tools", "Reply with exactly LOCAL_PROMPT_REPLACE_OK.",
  ], {
    cwd: repo,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise<number>((resolve) => {
    const timeout = setTimeout(() => child.kill(), 15_000);
    child.on("close", (code) => { clearTimeout(timeout); resolve(code ?? -1); });
  });
  if (exitCode !== 0) {
    throw new Error(`Pi exited ${exitCode}; request=${JSON.stringify(requestBody)}; stdout=${stdout}; stderr=${stderr}`);
  }
  assert.ok(requestBody, "local provider received no request");
  const serialized = JSON.stringify(requestBody);
  assert.match(serialized, /You are a coding assistant\. Follow the user's task/);
  assert.doesNotMatch(serialized, /You are a coding assistant running inside pi, a coding agent harness\./);
  assert.match(stdout, /LOCAL_PROMPT_REPLACE_OK/);
  console.log(JSON.stringify({ roles: requestBody.messages?.map((message: any) => message.role) ?? [], stdout: stdout.trim() }));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(agentDir, { recursive: true, force: true });
}
