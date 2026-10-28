import assert from "node:assert/strict";
import test from "node:test";
import { nativeSmoke } from "./native.ts";

test("real Pi SDK and CLI package loading, print, JSON and RPC command flows", { timeout: 180_000 }, async () => {
  const result = await nativeSmoke();
  assert.equal(result.results.length, 3);
});
