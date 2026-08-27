# 00 - Pi Host Contract Spike

Type: research
Status: resolved
Blocked by:

## Question

Can Image Input observe native TUI editing, fail closed at `input`, retain images through normal queues, track compaction to completion, and normalize supported images using the tested Pi host contracts?

## Answer

The executable and source-level findings are recorded in [host-contract-spike.md](../host-contract-spike.md). The spike used exact Pi 0.84.2 behavior to expose the original gaps and verified that Pi 0.84.3 adds the required `session_compact_failed` lifecycle event.

The implementation contracts are now settled in [spec.md](../spec.md):

- observe `handleInput()`, `insertTextAtCursor()`, and `setText()` through `CustomEditor`;
- catch `input` failures and return `{ action: "handled" }` because thrown handler errors are fail-open;
- maintain a plugin-owned prepared ledger because queue dequeue surfaces return text without images or stable IDs;
- require Pi 0.84.3 or newer and use `session_compact_failed` instead of a 0.84.2 workaround;
- accept `pi-clipboard-*` as a smoke-tested compatibility heuristic;
- keep pending mappings in memory, use exclusive queued ownership, and recover counters best effort from image-bearing history;
- process PNG, JPEG, and WebP while leaving GIF as an ordinary Pi path.

No remaining host-contract or P0 product decision blocks implementation.

## Comments

- The isolated harness used real Pi editor/session/extension/image code and a synthetic local provider; it made no network model requests.
- Real TUI, platform clipboard, provider, queue, and lifecycle behavior remains part of implementation acceptance testing.
