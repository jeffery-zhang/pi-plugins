# TUI Clipboard Image Attachment Bridge

Status: ready-for-agent

## Problem Statement

Pi 的 TUI 在用户粘贴图片时，会把剪贴板图片写入本地临时文件，并将路径插入 editor。提交后该路径只是普通文本，模型通常需要自行调用 `read` 才能看到图片；图片不一定作为同一条 user message 的原生 image content 交付。

Image Input 的 P0 目标是把 Pi 原生 TUI clipboard path 在提交入口转换为 Image Attachment。P0 不改变 editor 展示，不提供稳定图片编号，也不限制模型自主选择工具；它保证成功转换的图片已经随同一条 user message 交付，因此模型无需通过路径读取图片。

## Solution

提供一个支持 Pi 0.84.3 及以上版本的 TUI 专属扩展。Editor 继续显示 Pi 插入的原始临时路径，插件不安装或包装 custom editor。

当 Pi 处于 idle 状态且收到 interactive `input` 时，扩展扫描所有 canonical PNG、JPEG 和 WebP Clipboard Image Path，按文本 occurrence 顺序读取、校验并使用 Pi 的公开能力规范化图片。成功后，每个路径在提交文本中的原位置变为 `[Image]`，对应 Image Attachment 按 occurrence 顺序追加。Session history 保存 Image Marker 和 Image Attachment，不保存已转换的临时路径。

如果任何插件拥有的图片无法完整交付，整条提交失败关闭，原始 Image Draft 被恢复。Streaming 或 compaction 期间不接受包含 Clipboard Image Path 的提交，避免图片退化为不可恢复的纯文本 queue entry。

## P0 Product Decisions

- 最低兼容版本为 `@earendil-works/pi-coding-agent@0.84.3`；更早版本不受支持。
- 插件接受 `<os.tmpdir()>/pi-clipboard-<uuid>.<ext>` 作为版本绑定、由自动检查和真实 TUI smoke 保护的兼容约定。
- P0 只转换 PNG、JPEG 和 WebP。GIF、普通文件路径和非 canonical 临时路径保持 Pi 的普通文本行为。
- 插件不安装 custom editor，不隐藏 editor 中的临时路径，也不与 `pi-fff` 或其他 editor extension 竞争。
- 每个 eligible path occurrence 在提交文本中替换为无编号的 `[Image]`；用户手写的 `[Image]` 只是普通文本。
- 同一草稿中的所有 eligible paths 都被转换。每个 occurrence 产生一张附件，不按路径字符串去重。
- 插件创建的 Image Attachments 按 path occurrence 顺序追加在已有 `event.images` 之后。
- 图片提交仅在 Pi idle 时允许。Streaming、follow-up、steer 和 active compaction 不进入 P0 图片交付路径。
- 所有插件拥有的图片采用全有或全无语义；读取、格式、规范化、模型能力或 busy-state 失败时阻止提交并恢复原始草稿。
- 成功转换保证 Pi user message 包含 ImageContent 且不暴露对应临时路径，但不保证模型永远不会自主调用工具。
- RPC、CLI、extension source、JSON 和 print 模式保持原契约。

## User Stories

1. As a TUI user, I want a pasted supported image delivered as image content with my prompt so the model does not need to read a temporary file.
2. As a TUI user, I accept that the editor continues to show Pi's temporary path before submission.
3. As a TUI user, I want each converted path replaced by `[Image]` in the submitted message and session history.
4. As a TUI user, I want multiple clipboard images converted in textual occurrence order.
5. As a TUI user, I want an existing path repeated twice to produce two markers and two attachments.
6. As a TUI user, I want handwritten `[Image]` text to remain ordinary text.
7. As a TUI user, I want PNG, JPEG, and WebP converted while GIF remains an ordinary path.
8. As a TUI user, I want any conversion failure to block the whole prompt and restore my original path-bearing draft.
9. As a TUI user, I want unsupported image models to block image submission instead of silently dropping attachments.
10. As a TUI user, I want image-path submission blocked while Pi is streaming or compacting so it cannot enter a text-only queue.
11. As a TUI user, I want text-only prompts and arbitrary paths to retain Pi's existing behavior.
12. As a TUI user, I want normalized Image Attachments retained in session history for resume and fork replay.
13. As an RPC or CLI user, I want existing path, payload, steer/follow-up, and `@file` behavior unchanged.
14. As a maintainer, I want the bridge to coexist with `pi-fff` and other editor extensions because it does not replace the editor.

## Implementation Decisions

- The feature remains an independent private ESM Pi package with explicit `pi.extensions`, package-local `check`/`test`, and Pi-owned peer dependencies set to `"*"`.
- The package checks Pi's exported `VERSION` at runtime. Below 0.84.3 it remains inert and emits one concise TUI warning.
- Core conversion runs only for `event.source === "interactive"` in TUI mode. Other sources return `continue` unchanged.
- The extension never calls `setEditorComponent()` and does not read the clipboard. Pi remains responsible for platform clipboard access and inserting paths into the editor.
- Path recognition requires a file directly beneath `os.tmpdir()`, a canonical `pi-clipboard-<uuid>` basename, a PNG/JPG/JPEG/WebP suffix, and safe textual boundaries. Arbitrary paths are ignored.
- Eligible occurrences are collected before I/O. Identical paths may share a normalized in-memory result within one submission, but an attachment is emitted for every occurrence.
- Each unique file is read with the event `AbortSignal`, checked by content signature, and normalized once with Pi's public `resizeImage()` defaults. A `null` result is failure.
- Before conversion, the selected model must advertise image input support.
- Successful text transformation replaces eligible path occurrences in place with `[Image]`. Whitespace and surrounding user text are otherwise preserved.
- Existing `event.images` are preserved byte-for-byte and remain first; plugin-created flat `{ type: "image", data, mimeType }` attachments follow occurrence order.
- The `input` handler catches all processing errors, restores the original text through public TUI editor APIs, notifies the user, and returns `{ action: "handled" }`. It never relies on throwing because Pi treats `input` exceptions as fail-open.
- Streaming input that reaches the `input` hook is handled and restored instead of queued.
- Active compaction is guarded before TUI submit through public terminal-input/editor-text APIs, using Pi lifecycle events to track compaction completion. The guard consumes only image-bearing submit attempts and leaves ordinary editing available.
- No prepared ledger, queue correlation, image provenance, session counter, historical reattachment, or image-specific session persistence is maintained.
- The plugin does not delete Pi-owned temporary clipboard files.
- No third-party runtime dependency is required.
- Package documentation records the private path heuristic, supported formats, idle-only rule, failure behavior, marker semantics, and verification commands. Root README remains synchronized.

## Testing Decisions

- The primary automated seam is a package-level extension scenario harness using the real Pi 0.84.3 input/image contracts and a fake TUI context.
- Path tests cover canonical Windows/POSIX forms, temp directories with spaces, punctuation boundaries, near-match suffixes, GIF, arbitrary paths, and actual `crypto.randomUUID()` basenames.
- Happy-path scenarios cover one PNG/JPEG/WebP path, path-only input, surrounding text, handwritten `[Image]`, existing input images, and persisted-message shape.
- Multi-image scenarios cover mixed formats, textual order, repeated identical paths, one marker per occurrence, and normalization reuse without attachment deduplication.
- Failure scenarios cover missing/unreadable files, content-signature mismatch, malformed images, `resizeImage()` returning `null`, unsupported models, abort, and unexpected errors. Every case asserts no provider delivery, exact draft restoration, and a concise notification.
- Busy-state scenarios cover streaming steer/follow-up and active compaction. Image-bearing submit is blocked and restored; text-only input remains unaffected.
- Mode-isolation scenarios cover RPC, extension source, JSON/print, CLI-style existing images, GIF, arbitrary paths, and unknown markers.
- A dedicated regression proves thrown processing errors are converted to `action: "handled"` so raw paths cannot fail open to the model.
- Real TUI smoke runs with normal installed extensions, including `pi-fff`. It verifies editor paths remain visible before submit, the submitted/session text contains `[Image]` without `pi-clipboard-*`, and the same user message contains ImageContent.
- Model behavior is evidence only: a correct image response is useful, but session message structure is the delivery authority.
- Declared `check` and `test`, frozen lockfile validation, and `git diff --check` must pass. No installation command is run unless explicitly requested.

## Out of Scope

- Stable or numbered Image References.
- Hiding or replacing image paths while editing.
- Image previews or custom editor rendering.
- Generic conversion of arbitrary user-typed image paths.
- Plugin-managed GIF attachment or animation preservation.
- Streaming steer/follow-up image queues, dequeue recovery, or prepared ledgers.
- Persisting image provenance, pending paths, counters, or an image library.
- Automatically reattaching historical images.
- Guaranteeing that a model never calls `read` or another tool.
- Reimplementing platform clipboard access.
- Deleting Pi-owned temporary files.
- Configurable marker text, compression settings, limits, or failure policy in P0.
- Publishing or installing the package.

## Further Notes

- Canonical domain vocabulary is defined by `packages/image-input/CONTEXT.md`.
- Pi's image content contract is the flat `type`, base64 `data`, and `mimeType` representation.
- The original stable-reference design was dropped after real TUI validation showed editor-factory conflicts with installed `pi-fff`. The bridge avoids that integration surface entirely.
- Pi already normalizes CLI images, built-in read results, and tool-result images at their own ingress points. This extension adds normalization only for supported TUI clipboard paths.
- No ADR is required for P0; the simplified bridge is isolated and reversible.
