import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { fixture, model, entry, SECRET } from "./harness.ts";

test("single command updates real Pi metadata, preserves JSONC and credentials, backs up and is repeatable", async () => {
  const f = await fixture();
  try {
    const current = f.session.model;
    await f.command();
    assert.deepEqual(f.errors, []);
    assert.equal(f.previews.length, 1);
    assert.match(f.previews[0]!, /\ncontextWindow:/);
    const loaded = await f.loaded();
    assert.equal(loaded.contextWindow, 400000); assert.equal(loaded.maxTokens, 128000);
    assert.deepEqual(loaded.input, ["text", "image"]);
    assert.deepEqual(loaded.thinkingLevelMap, { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: null });
    assert.deepEqual(loaded.cost, { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 9, tiers: undefined });
    assert.equal(f.session.model, current); assert.equal(f.session.model?.contextWindow, 20000);
    const config = await f.config();
    assert.equal(config.providers.fixture.apiKey, SECRET);
    assert.deepEqual(config.providers.fixture.models, [model()]);
    assert.equal((await f.state()).sources['fixture/a'], 'fixture/a');
    const text = await readFile(f.configPath, "utf8");
    assert.ok(text.startsWith("\uFEFF// Model Detect test comment\r\n"));
    assert.ok(!text.replace(/\r\n/g, "").includes("\n"));
    const backups = await f.backups(); assert.equal(backups.length, 1);
    assert.deepEqual(await readFile(join(f.agentDir, "model-detect", "backups", backups[0]!, "models.json")), f.original);
    assert.match(f.notices.at(-1)!, /重启 Pi 生效/);
    await f.command();
    assert.equal(f.previews.length, 1); assert.match(f.notices.at(-1)!, /参数未变化 1/);
    assert.equal(f.data.requests, 2);
  } finally { await f.close(); }
});

test("TUI full diff scrolls without hiding controls, Escape cancels and Enter publishes", async t => {
  for (const accept of [false, true]) await t.test(String(accept), async () => {
    const f = await fixture({ mode: 'tui', definitions: Array.from({ length: 4 }, (_, index) => model('m' + index)),
      directory: { fixture: { models: Object.fromEntries(Array.from({ length: 4 }, (_, index) => ['m' + index, entry('m' + index)])) } } });
    try {
      f.uiKeys.push('\u001b[6~', '\u001b[F', accept ? '\r' : '\u001b');
      await f.command('/detect fixture');
      assert.deepEqual(f.errors, []); assert.ok(f.frames.length >= 3);
      for (const frame of f.frames) {
        assert.ok(frame.length <= 24); assert.ok(frame.at(-1)!.includes('Esc 取消'));
      }
      assert.ok(f.frames[2]!.join('\n').includes('重启 Pi 生效'));
      if (accept) assert.equal((await f.loaded('m0')).contextWindow, 400000);
      else assert.deepEqual(await readFile(f.configPath), f.original);
    } finally { await f.close(); }
  });
});

test("TUI network Escape and repeated command cancel cleanly without a leaked lock", async () => {
  const f = await fixture({ mode: 'tui' });
  try {
    f.data.stall = true; const seen = f.requestSeen(); const running = f.command(); await seen;
    await f.command(); assert.match(f.errors.join(''), /正在运行/);
    f.terminalKey('\u001b'); await running;
    assert.deepEqual(await readFile(f.configPath), f.original);
    assert.ok(!(await readdir(f.agentDir)).includes('model-detect.lock'));
  } finally { await f.close(); }
});

test("TUI ambiguous names use a bounded scrolling source list", async () => {
  const directory = Object.fromEntries(Array.from({ length: 12 }, (_, index) => ['vendor' + index, { models: { x: entry('x', { name: 'Same Name' }) } }]));
  const f = await fixture({ mode: 'tui', directory });
  try {
    f.answers.push('Same Name'); f.uiKeys.push('\u001b[B', '\r'); await f.command();
    assert.deepEqual(f.errors, []); assert.equal((await f.state()).sources['fixture/a'], 'vendor1/x');
    assert.ok(f.frames[0]!.join('\n').includes('选择唯一来源'));
    assert.ok(f.frames[0]!.length < 24);
  } finally { await f.close(); }
});

test("invalid UTF-8, duplicate keys and structural errors reject before directory access", async t => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{"providers":{},"providers":{}}'), Buffer.from('{"providers":[]}')]) await t.test(bytes.toString('hex'), async () => {
    const f = await fixture();
    try {
      await writeFile(f.configPath, bytes); await f.command();
      assert.equal(f.errors.length, 1); assert.equal(f.data.requests, 0);
      assert.deepEqual(await readFile(f.configPath), bytes);
    } finally { await f.close(); }
  });
});

test("built-in single target without a models declaration can be updated; authentication-only batch stays empty", async () => {
  const f = await fixture({ provider: 'openai', config: { providers: { openai: { apiKey: SECRET } } },
    directory: { openai: { models: { 'gpt-5': entry('gpt-5') } } } });
  try {
    await f.command('/detect openai'); assert.equal(f.data.requests, 0);
    await f.command('/detect openai/gpt-5');
    const config = await f.config(); assert.equal(config.providers.openai.models, undefined);
    assert.ok(config.providers.openai.modelOverrides['gpt-5']);
    assert.equal((await f.loaded('gpt-5')).contextWindow, 400000);
  } finally { await f.close(); }
});

test("explicit source text can replace an existing exact match or saved mapping", async () => {
  const f = await fixture({ directory: { fixture: { models: { a: entry() } }, original: { models: { x: entry('x', { name: 'Original Model Name', limit: { context: 600000, output: 64000 } }) } } } });
  try {
    await f.command('/detect fixture/a');
    await f.command('/detect fixture/a Original Model Name');
    assert.equal((await f.state()).sources['fixture/a'], 'original/x');
    assert.equal((await f.loaded()).contextWindow, 600000);
    assert.equal(f.selectionLists.length, 1);
  } finally { await f.close(); }
});

test("saved source outranks local exact matches and old tiers do not mix with new base prices", async () => {
  const originalCost = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, tiers: [{ inputTokensAbove: 20000, input: 5, output: 6, cacheRead: 7, cacheWrite: 8 }] };
  const f = await fixture({ definitions: [model('a', { cost: originalCost })], directory: {
    fixture: { models: { a: entry('a') } }, chosen: { models: { x: entry('x', { limit: { context: 500000, output: 100000 } }) } },
  } });
  try {
    await writeFile(join(f.agentDir, 'model-detect.json'), JSON.stringify({ sources: { 'fixture/a': 'chosen/x' } }));
    await f.command(); assert.equal((await f.loaded()).contextWindow, 500000);
    assert.deepEqual((await f.loaded()).cost, originalCost); assert.match(f.previews[0]!, /整个价格组/);
    assert.equal(f.selectionLists.length, 0);
  } finally { await f.close(); }
});

test("user cancellation, no UI and unknown targets never write or start models", async t => {
  for (const action of ['decline', 'no-ui', 'unknown', 'help', 'empty-provider']) await t.test(action, async () => {
    const f = await fixture({ mode: action === 'no-ui' ? 'print' : 'rpc' });
    try {
      if (action === 'decline') f.consent(false);
      await f.command(action === 'unknown' ? '/detect fixture/missing' : action === 'help' ? '/detect' : action === 'empty-provider' ? '/detect other' : undefined);
      assert.deepEqual(await readFile(f.configPath), f.original);
      assert.equal((await f.backups()).length, 0);
      if (action === 'no-ui') assert.match(f.errors.join(''), /交互 UI/);
      if (action === 'unknown') assert.match(f.errors.join(''), /未识别/);
      if (action !== 'decline') assert.equal(f.data.requests, 0);
    } finally { await f.close(); }
  });
});

test("custom IDs select one source, save per-target mappings, and reuse them without changing identity", async () => {
  const f = await fixture({ definitions: [model('alias')], directory: {
    openai: { models: { 'gpt-5': entry('gpt-5', { name: 'GPT Five' }) } },
    proxy: { models: { 'gpt-5': entry('gpt-5', { name: 'GPT Five', limit: { context: 100000, output: 30000 } }) } },
  } });
  try {
    f.answers.push('GPT Five'); await f.command('/detect fixture/alias');
    assert.equal(f.selectionLists[0]?.length, 2); assert.equal(f.previews.length, 1);
    assert.equal((await f.state()).sources['fixture/alias'], 'openai/gpt-5');
    assert.equal((await f.loaded('alias')).cost.input, 1.25);
    assert.equal((await f.config()).providers.fixture.models[0].id, 'alias');
    assert.match(f.previews[0]!, /fixture\/alias ← openai\/gpt-5/);
    await f.command('/detect fixture/alias'); assert.equal(f.selectionLists.length, 1);
    await writeFile(join(f.agentDir, 'model-detect.json'), JSON.stringify({ sources: { 'fixture/alias': 'removed/missing' } }));
    f.answers.push('proxy/gpt-5'); await f.command('/detect fixture/alias');
    assert.equal((await f.state()).sources['fixture/alias'], 'proxy/gpt-5');
    assert.equal((await f.loaded('alias')).contextWindow, 100000);
  } finally { await f.close(); }
});

test("manual lookup cancellation leaves mapping and model intact, malformed mapping fails closed", async () => {
  const f = await fixture({ directory: { original: { models: { b: entry('b') } } } });
  try {
    f.answers.push('not-found', undefined); await f.command();
    assert.match(f.notices.join(''), /没有匹配/); assert.match(f.notices.at(-1)!, /目标跳过 1/);
    assert.deepEqual(await readFile(f.configPath), f.original);
    await writeFile(join(f.agentDir, 'model-detect.json'), '{broken'); await f.command();
    assert.match(f.errors.join(''), /JSON 无效/); assert.equal(f.data.requests, 1);
  } finally { await f.close(); }
});

test("budget, toggle, unknown efforts and missing reasoning preserve the whole thought group", async t => {
  for (const options of [[{ type: 'budget_tokens', min: 1024 }], [{ type: 'toggle' }], [{ type: 'effort', values: ['default'] }], [], undefined]) await t.test(JSON.stringify(options) ?? 'missing', async () => {
    const f = await fixture({ directory: { fixture: { models: { a: entry('a', { reasoning_options: options }) } } } });
    try {
      await f.command(); const loaded = await f.loaded();
      assert.equal(loaded.reasoning, true); assert.deepEqual(loaded.thinkingLevelMap, model().thinkingLevelMap);
      assert.match(f.previews[0]!, /整个思考组/); assert.equal(loaded.contextWindow, 400000);
    } finally { await f.close(); }
  });
});

test("reasoning false and none/xhigh/max efforts have real Pi semantics", async t => {
  for (const reasoning of [false, true]) await t.test(String(reasoning), async () => {
    const f = await fixture({ directory: { fixture: { models: { a: entry('a', { reasoning, reasoning_options: [{ type: 'effort', values: ['none', 'high', 'xhigh', 'max'] }] }) } } } });
    try {
      await f.command(); const loaded = await f.loaded(); assert.equal(loaded.reasoning, reasoning);
      if (reasoning) assert.deepEqual(loaded.thinkingLevelMap, { off: 'none', minimal: null, low: null, medium: null, high: 'high', xhigh: 'xhigh', max: 'max' });
    } finally { await f.close(); }
  });
});

test("zero and invalid limits/modalities preserve local values; non-token price gaps remain unknown", async () => {
  const f = await fixture({ directory: { fixture: { models: { a: entry('a', {
    limit: { context: 0, output: -1 }, modalities: { input: ['pdf', 'audio'] }, cost: { input: 0, output: null, cache_read: -3, input_audio: 2 },
  }) } } } });
  try {
    await f.command(); const loaded = await f.loaded();
    assert.equal(loaded.contextWindow, 20000); assert.equal(loaded.maxTokens, 1000); assert.deepEqual(loaded.input, ['text']);
    assert.deepEqual(loaded.cost, { input: 0, output: 9, cacheRead: 9, cacheWrite: 9, tiers: undefined });
    assert.match(f.previews[0]!, /不代表免费/);
    assert.match(f.previews[0]!, /其他计费维度 input_audio 未写入 Pi/);
  } finally { await f.close(); }
});

test("complete tiers map exact thresholds; incomplete tiers retain entire price group", async t => {
  for (const complete of [true, false]) await t.test(String(complete), async () => {
    const cost = { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75,
      tiers: [{ input: 6, output: 22.5, cache_read: 0.6, ...(complete ? { cache_write: 7.5 } : {}), tier: { type: 'context', size: 272000 } }],
      context_over_200k: { input: 100 },
    };
    const f = await fixture({ directory: { fixture: { models: { a: entry('a', { cost }) } } } });
    try {
      await f.command(); const loaded = await f.loaded();
      if (complete) assert.deepEqual(loaded.cost.tiers, [{ inputTokensAbove: 272000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 }]);
      else { assert.deepEqual(loaded.cost, model().cost); assert.match(f.previews[0]!, /整个价格组/); }
    } finally { await f.close(); }
  });
});

test("provider batch deduplicates explicit targets, preserves model slash IDs and reports partial success", async () => {
  const config = { providers: { fixture: { api: 'openai-responses', apiKey: SECRET, baseUrl: 'http://127.0.0.1:1/v1', models: [model(), model('nested/id'), model('missing')],
    modelOverrides: { a: { name: 'Keep name' }, unknown: { contextWindow: 11111 } } }, other: { api: 'openai-responses', apiKey: SECRET, baseUrl: 'http://127.0.0.1:1/v1', models: [model()] } } };
  const f = await fixture({ config, directory: { fixture: { models: { a: entry(), 'nested/id': entry('nested/id'), unconfigured: entry('unconfigured') } } } });
  try {
    f.answers.push(undefined); await f.command('/detect fixture');
    assert.equal(f.data.requests, 1); assert.equal(f.previews.length, 1);
    assert.match(f.previews[0]!, /目标跳过 2/); assert.match(f.previews[0]!, /unknown：跳过/);
    const after = await f.config(); assert.deepEqual(after.providers.other, config.providers.other);
    assert.equal(after.providers.fixture.models.length, 3); assert.equal(after.providers.fixture.modelOverrides.a.name, 'Keep name');
    assert.equal(after.providers.fixture.modelOverrides.unconfigured, undefined);
    assert.equal((await f.loaded('nested/id')).contextWindow, 400000);
    assert.equal((await f.state()).sources['fixture/nested/id'], 'fixture/nested/id');
  } finally { await f.close(); }
});

test("network status, JSON and shape errors, timeout, and shutdown never publish", async t => {
  for (const kind of ['http', 'json', 'shape', 'content', 'timeout', 'shutdown']) await t.test(kind, async () => {
    const f = await fixture({ timeoutMs: kind === 'timeout' ? 40 : 30000 });
    try {
      if (kind === 'http') f.data.status = 503;
      if (kind === 'json') f.data.malformed = true;
      if (kind === 'shape') f.data.directory = {};
      if (kind === 'content') f.data.contentType = 'text/html';
      if (kind === 'timeout' || kind === 'shutdown') f.data.stall = true;
      const seen = f.requestSeen(); const command = f.command();
      if (kind === 'shutdown') { await seen; await f.session.extensionRunner!.emit({ type: 'session_shutdown', reason: 'quit' }); }
      await command;
      assert.deepEqual(await readFile(f.configPath), f.original); assert.equal((await f.backups()).length, 0);
      if (kind !== 'shutdown') assert.equal(f.errors.length, 1);
    } finally { await f.close(); }
  });
});

test("concurrent file changes and another detect lock reject publication", async t => {
  for (const kind of ['configuration', 'lock', 'mapping']) await t.test(kind, async () => {
    const f = await fixture();
    try {
      const modified = Buffer.concat([f.original, Buffer.from('// External change\r\n')]);
      if (kind === 'configuration') f.beforeConfirm(async () => { await writeFile(f.configPath, modified); });
      if (kind === 'mapping') f.beforeConfirm(async () => { await writeFile(join(f.agentDir, 'model-detect.json'), '{"sources":{}}\n'); });
      if (kind === 'lock') await writeFile(join(f.agentDir, 'model-detect.lock'), 'Another operation');
      await f.command(); assert.equal(f.errors.length, 1);
      assert.deepEqual(await readFile(f.configPath), kind === 'configuration' ? modified : f.original);
      assert.equal((await f.backups()).length, 0);
      if (kind === 'lock') assert.equal(await readFile(join(f.agentDir, 'model-detect.lock'), 'utf8'), 'Another operation');
    } finally { await f.close(); }
  });
});

test("publication failure rolls back model and mapping, preserves backup and releases lock", async () => {
  let renames = 0;
  const f = await fixture({ rename: async (from, to) => { if (++renames === 2) throw new Error(SECRET); await rename(from, to); } });
  try {
    await f.command(); assert.match(f.errors[0]!, /已回退/);
    assert.deepEqual(await readFile(f.configPath), f.original);
    await assert.rejects(readFile(join(f.agentDir, 'model-detect.json')), { code: 'ENOENT' });
    assert.equal((await f.backups()).length, 1);
    assert.ok(!(await readdir(f.agentDir)).some(file => file.endsWith('.tmp') || file.endsWith('.lock')));
  } finally { await f.close(); }
});
