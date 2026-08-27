# 00 - Pi Host Contract Spike

Type: research
Status: resolved
Blocked by:

## Question

Can Image Input convert Pi-native TUI clipboard image paths into same-message ImageContent while preserving Pi's other input contracts?

## Answer

The executable and source findings are recorded in [host-contract-spike.md](../host-contract-spike.md). Pi 0.84.3 provides the required interactive `input` transform, flat ImageContent contract, `resizeImage()`, lifecycle events, editor text APIs, and terminal-input observation.

Manual TUI validation added one decisive finding: explicit `-e` extensions load before installed packages, and `pi-fff` later installs its own `FffEditor`. The original Image Input custom editor was therefore overwritten. With automatic extensions disabled, the editor-based implementation worked, proving the conflict rather than path recognition was the failure.

The P0 design now avoids custom editors entirely. It scans canonical paths at idle submission, replaces each submitted path with `[Image]`, appends ImageContent, and blocks busy-state image submission. Queue IDs, stable references, provenance, and editor composition are no longer required.

No remaining host-contract or P0 product decision blocks the revised implementation.

## Comments

- `input` exceptions are fail-open and must be converted to draft restoration, notification, and `{ action: "handled" }`.
- Pi normal queues retain transformed images internally, but revised P0 blocks image submission while non-idle and therefore needs no queue ledger.
- The private `pi-clipboard-*` filename remains a compatibility heuristic protected by package tests and real TUI smoke.
