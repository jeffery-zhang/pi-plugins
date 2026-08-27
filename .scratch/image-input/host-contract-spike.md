# Image Input Host Contract Spike

Status: resolved
Baseline: `@earendil-works/pi-coding-agent@0.84.2`
Comparison: local `pi 0.84.3`

## Question

Can the Image Input specification be implemented against Pi 0.84.2 using the public extension/editor surface, especially for editor observation, fail-closed input handling, streaming queues, compaction, and image normalization?

## Method

The spike used two first-party evidence paths:

1. The official 0.84.2 npm release, its bundled docs, declarations, and runtime source, compared with the installed 0.84.3 release.
2. An isolated executable harness pinned to 0.84.2. It used the real `CustomEditor`, `AgentSession`, extension runner, in-memory session/settings, public `resizeImage`, and a synthetic local provider. No network model request was made.

The executable scenarios covered:

- host-style `insertTextAtCursor()` and programmatic `setText()` calls on a `CustomEditor` subclass;
- `input` handler throw, `handled`, `transform`, interactive/RPC source isolation;
- streaming steer/follow-up, queue delivery, `clearQueue()`, and user `message_start`;
- manual compaction success, extension cancellation, and provider failure;
- PNG, JPEG, WebP, static GIF, animated GIF, malformed image input, and forced resize.

## Results

### Editor observation: pass with an explicit integration rule

The exact 0.84.2 `CustomEditor` instance observed both host pathways:

- native image insertion reached the overridable public `insertTextAtCursor(path)` method;
- programmatic restoration reached the overridable public `setText(text)` method.

The spike replaced canonical temporary paths in both pathways and retained normal submit behavior. Therefore the implementation must observe all three surfaces, not only terminal input:

- `handleInput()` for normal editing;
- `insertTextAtCursor()` for native clipboard insertion;
- `setText()` for dequeue, session navigation, reload, and other host restoration.

This is compatible with the 0.84.2 runtime, but the `pi-clipboard-<uuid>` filename is still an internal host convention rather than a public exported contract. It must be documented as a version-guarded compatibility heuristic and protected by smoke tests.

### Input semantics: pass, with a mandatory fail-closed rule

Observed behavior:

| Scenario | Result |
| --- | --- |
| handler throws | extension error is recorded; original input still reaches the provider |
| handler returns `handled` | provider request is stopped |
| handler returns `transform` | flat `{ type, data, mimeType }` image reaches the same user message |
| source is `rpc` | an interactive-only handler can return the input unchanged |

The implementation must catch every read, validation, and normalization failure inside the `input` handler, restore the draft, notify the TUI, and return `{ action: "handled" }`. Throwing is fail-open in this event type.

When replacing images, `images: undefined` preserves previous images. An explicit empty array is required to clear images.

### Streaming queue: delivery passes; reversible dequeue requires plugin state

Observed behavior:

- steer/follow-up queue entries retain transformed images internally;
- queued user `message_start` contains the final text and image content;
- `input.streamingBehavior` identifies `steer` or `followUp`;
- public queue mirrors, getters, `queue_update`, and `clearQueue()` expose only text;
- `message_start` exposes no draft ID or queue ID.

Consequences:

- normal queued delivery is supported;
- dequeue cannot reconstruct images from Pi's return value;
- the plugin must keep its own prepared/queued ledger until delivery;
- correlation by text alone is ambiguous for duplicate text;
- queue policy must either assign plugin-owned submission IDs internally, forbid ambiguous reuse, or explicitly define FIFO/reference-set matching semantics.

### Compaction: 0.84.2 has an end-state event gap

Observed extension events:

| Manual case | Extension events | `ctx.isIdle()` after completion |
| --- | --- | --- |
| success | `session_before_compact`, `session_compact` | `true` |
| extension cancel | `session_before_compact` only | `true` |
| provider failure | `session_before_compact` only | `true` |

In 0.84.2 there is no extension event for compaction cancellation or failure. `ctx.isIdle()` becomes true afterward, but this is an indirect observation and does not identify compaction while it is active. The TUI also diverts submissions into its special compaction text queue before `session.prompt()` and the `input` hook.

Version 0.84.3 adds `session_compact_failed`, which closes the missing end-event branch but does not expose the TUI queue's images or stable queue IDs.

A strict 0.84.2 implementation therefore needs a documented compatibility state machine using `session_before_compact`, `session_compact`, the event signal, editor submission gating, and an `isIdle()` reconciliation fallback. That state machine remains a compatibility workaround, not a direct public `isCompacting` contract.

### Image normalization: pass for supported decoding; GIF animation is conditional

Observed 16x16 inputs:

| Input | Default result | Forced 8x8 result |
| --- | --- | --- |
| PNG | original PNG | resized PNG |
| JPEG | original JPEG | resized PNG |
| WebP | original WebP | resized PNG |
| static GIF | original GIF | resized PNG |
| animated GIF | original GIF | resized PNG |
| malformed PNG bytes | `null` | n/a |

Small GIFs remain byte-for-byte eligible for the no-resize path, so animation can survive. Once resize is required, Pi re-encodes to PNG/JPEG and does not guarantee animation. The root package does not export its internal MIME detector; content sniffing must be implemented with Node.js and covered by fixtures.

### Model and content contracts: pass

The 0.84.2 public contracts provide:

- `ctx.model?.input.includes("image")` as the model capability signal;
- flat `ImageContent` as `{ type: "image", data: string, mimeType: string }`;
- root-exported `resizeImage()` returning `ResizedImage | null`.

The capability signal does not guarantee that every provider accepts every MIME type, so real-provider smoke tests remain necessary.

## Verdict

The public `input` transform and image normalization contracts are sufficient for the revised Pi 0.84.3 P0 Attachment Bridge.

Real TUI validation established that the original stable-reference editor design conflicts with installed editor extensions: explicit `-e` Image Input loaded first, then `pi-fff` installed `FffEditor` and replaced it. With automatic extensions disabled, the editor path worked, confirming an editor-factory conflict rather than clipboard-path recognition failure.

The revised P0 avoids custom editors. It converts canonical paths at idle submission, replaces them with `[Image]`, appends ImageContent, and blocks busy-state image submission. The private path heuristic is accepted, GIF is passthrough, and no queue ledger or provenance is required. The revised specification is implementation-ready.

## Remaining Manual Verification

Implementation verification still needs:

- real TUI single- and multi-image submission with normal installed extensions, including `pi-fff`;
- session inspection proving `[Image]` plus ImageContent and no converted temporary path;
- unsupported-model and conversion-failure draft restoration;
- streaming and active-compaction submission guards;
- Windows coverage first, with WSL, X11/Wayland, and macOS clipboard smoke where available;
- target providers with PNG, JPEG, and WebP.

## Primary Sources

- Pi 0.84.2 extension runtime: `dist/core/extensions/runner.js`, `dist/core/extensions/types.d.ts`
- Pi 0.84.2 session runtime: `dist/core/agent-session.js`
- Pi 0.84.2 TUI host: `dist/modes/interactive/interactive-mode.js`
- Pi 0.84.2 editor: `@earendil-works/pi-tui/dist/components/editor.js`
- Pi 0.84.2 image normalization: `dist/utils/image-resize-core.js`
- Pi 0.84.2 public exports: `dist/index.d.ts`
- Pi 0.84.3 changelog and `SessionCompactFailedEvent` declaration
- Official tagged source: <https://github.com/earendil-works/pi/tree/v0.84.2>
- Official release metadata: <https://unpkg.com/@earendil-works/pi-coding-agent@0.84.2/package.json>
