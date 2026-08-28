# TUI Clipboard Image Attachment Bridge

Status: ready-for-agent

## Problem Statement

Pi 的 TUI 在用户粘贴图片时，会把剪贴板图片写入本地临时文件，并将路径插入 editor。Image Input 已能在 Pi idle 时把该路径转换为同一条 user message 中的 Image Attachment，但 Pi streaming 时的 `steer` 和 `followUp` 仍会被扩展阻止。

用户在长响应或工具执行期间经常需要通过图片补充、纠正或安排后续任务。等待 Pi idle 后再提交会打断原生消息队列工作流，因此 P0 需要让粘贴图片进入 Pi 已有的 `steer` 和 `followUp` 队列，同时不接管 editor、队列或 compaction。

## Solution

提供一个支持 Pi 0.84.3 及以上版本的 TUI 专属扩展。Editor 继续显示 Pi 插入的原始临时路径，插件不安装或包装 custom editor。

当扩展收到 idle、`steer` 或 `followUp` 的 interactive `input` 时，它扫描所有 canonical PNG、JPEG 和 WebP Clipboard Image Path，按文本 occurrence 顺序读取、校验并使用 Pi 的公开能力规范化图片。准备成功后，每个路径在提交文本中的原位置变为反引号包裹的 `[Image]`，对应 Image Attachment 按 occurrence 顺序追加，并由 Pi 按原生 idle、`steer` 或 `followUp` 语义交付。Active compaction 继续阻止包含 Clipboard Image Path 的提交。

所有插件拥有的图片必须在入队前准备成功；否则整条提交失败关闭并恢复原始 Image Draft。消息成功入队后由 Pi 原生队列负责生命周期：正常交付保留 Image Marker 和 Image Attachment，但 dequeue、Esc 或 abort 只恢复转换后的反引号包裹 `[Image]` 文本，排队后切换到纯文本模型也可能让 Pi 省略图片。P0 接受这些限制，不增加 prepared ledger 或 host contract。

## P0 Product Decisions

- 最低兼容版本保持 `@earendil-works/pi-coding-agent@0.84.3`；不修改 Pi host contract，也不提高版本基线。
- 插件接受 `<os.tmpdir()>/pi-clipboard-<uuid>.<ext>` 作为版本绑定、由自动检查和真实 TUI smoke 保护的兼容约定。
- P0 只转换 PNG、JPEG 和 WebP。GIF、普通文件路径和非 canonical 临时路径保持 Pi 的普通文本行为。
- 插件不安装 custom editor，不隐藏 editor 中的临时路径，也不与 `pi-fff` 或其他 editor extension 竞争。
- 每个 eligible path occurrence 在提交文本中替换为无编号、反引号包裹的 `[Image]`；用户手写的 `[Image]` 或反引号包裹的 `[Image]` 只是普通文本。
- 同一草稿中的所有 eligible paths 都被转换。每个 occurrence 产生一张附件，不按路径字符串去重。
- 插件创建的 Image Attachments 按 path occurrence 顺序追加在已有 `event.images` 之后。
- 图片提交在 Pi idle 以及原生 streaming `steer`、`followUp` 路径中允许；三者使用同一转换和失败语义。
- Active compaction 不进入 P0 图片交付路径。现有 terminal guard 继续把 Image Draft 留在 editor，同时保持纯文本 compaction queue 行为不变。
- 所有插件拥有的图片采用入队前全有或全无语义；读取、格式、规范化、取消或提交时的模型能力失败会阻止整条消息并恢复原始 Image Draft。
- 支持多条、重复及文字/图片混合的 queued user messages，并遵循 Pi 原生 `all` / `one-at-a-time` queue mode；插件不维护队列状态。
- 正常交付保证 queued user message 包含 Image Marker 和 Image Attachment，但 dequeue、Esc 或 abort 只恢复 `[Image]` 文本，图片附件可能丢失。P0 接受该限制。
- 提交时的当前模型必须声明 image input support。入队后若切换到纯文本模型，接受 Pi 把图片替换为 omitted 占位；扩展不阻止模型切换，也不强制把图片发送给上游。
- 成功转换不保证模型永远不会自主调用工具。
- RPC、CLI、extension source、JSON 和 print 模式保持原契约。

## User Stories

1. As a TUI user, I want a pasted supported image delivered as native image content, so that the model does not need to read a temporary file.
2. As a TUI user, I want Pi's existing editor to remain in control, so that Image Input continues to coexist with `pi-fff` and other editor extensions.
3. As a TUI user, I want each converted Clipboard Image Path replaced by a backtick-wrapped `[Image]`, so that submitted text and session history do not retain the temporary path and the TUI renders the marker with code emphasis after normal delivery.
4. As a TUI user, I want multiple clipboard images converted in textual occurrence order, so that each Image Marker corresponds positionally to the intended Image Attachment.
5. As a TUI user, I want repeated occurrences of one Clipboard Image Path to produce repeated attachments, so that repetition in my Image Draft is preserved.
6. As a TUI user, I want handwritten `[Image]` or backtick-wrapped `[Image]` text to remain ordinary text, so that marker-looking prose is not treated as an attachment.
7. As a TUI user, I want PNG, JPEG and WebP converted while GIF and arbitrary paths pass through, so that the supported path contract remains predictable.
8. As a TUI user, I want any pre-submission conversion failure to block the whole message and restore my Image Draft, so that partial image delivery cannot occur.
9. As a TUI user, I want a model without image input support to reject the Image Draft before submission, so that an unsupported current model cannot silently drop the attachment.
10. As a TUI user, I want to submit pasted images as native `steer` messages while Pi is streaming, so that I can correct or supplement the active task without waiting for idle.
11. As a TUI user, I want to submit pasted images as native `followUp` messages while Pi is streaming, so that I can queue later work with the required visual context.
12. As a TUI user, I want image-bearing queued messages to retain Pi's native delivery timing, so that Image Input does not redefine interruption or follow-up scheduling.
13. As a TUI user, I want multiple, duplicate and mixed text/image messages to respect Pi's configured queue mode, so that image support does not change normal queue ordering.
14. As a TUI user, I want dequeue, Esc and abort to retain Pi's native text-only recovery even though queued Image Attachments can be lost, so that Image Input can remain stateless and avoid replacing Pi's queue implementation.
15. As a TUI user, I want post-queue switching to a text-only model to retain Pi's native unsupported-image downgrade, so that Image Input does not add a model-switch state machine.
16. As a TUI user, I want active compaction to continue blocking image-bearing submissions, so that Clipboard Image Paths cannot enter Pi's text-only compaction queue.
17. As a TUI user, I want text-only prompts and arbitrary paths to retain Pi's existing idle, `steer`, `followUp` and compaction behavior, so that unrelated input is unaffected.
18. As a TUI user, I want normally delivered Image Attachments retained in session history, so that resume and fork replay preserve delivered visual context.
19. As an RPC or CLI user, I want existing path, payload, queue and `@file` behavior unchanged, so that a TUI clipboard bridge does not alter other ingress modes.
20. As a maintainer, I want streaming image delivery implemented without a custom editor, prepared ledger or persistent queue state, so that the extension remains small and compatible with Pi 0.84.3.

## Implementation Decisions

- The feature remains an independent publishable ESM Pi package with explicit `pi.extensions`, package-local `check`/`test`, and Pi-owned peer dependencies set to `"*"`.
- The package checks Pi's exported `VERSION` at runtime. Below 0.84.3 it remains inert and emits one concise TUI warning.
- Core conversion runs only for `event.source === "interactive"` in TUI mode. Other sources return `continue` unchanged.
- The extension accepts eligible input when Pi is idle or when `streamingBehavior` is `steer` or `followUp`. A non-idle input without either supported streaming behavior remains blocked.
- The extension never calls `setEditorComponent()` and does not read the clipboard. Pi remains responsible for platform clipboard access, editor presentation and queued-message scheduling.
- Path recognition requires a file directly beneath `os.tmpdir()`, a canonical `pi-clipboard-<uuid>` basename, a PNG/JPG/JPEG/WebP suffix, and safe textual boundaries. Arbitrary paths are ignored.
- Eligible occurrences are collected before I/O. Identical paths may share a normalized in-memory result within one submission, but an attachment is emitted for every occurrence.
- Each unique file is read with the event `AbortSignal`, checked by content signature, and normalized once with Pi's public `resizeImage()` defaults. A `null` result is failure.
- All image preparation completes before the input handler returns a transform, so a queued message is never accepted with an unread or unvalidated Clipboard Image Path.
- Before conversion, the selected model must advertise image input support. This check applies only at submission time; later model changes retain Pi's native behavior.
- Successful text transformation replaces eligible path occurrences in place with a backtick-wrapped `[Image]`. Whitespace and surrounding user text are otherwise preserved.
- Existing `event.images` are preserved byte-for-byte and remain first; plugin-created flat `{ type: "image", data, mimeType }` attachments follow occurrence order.
- The `input` handler catches all processing errors, restores the original text through public TUI editor APIs, notifies the user, and returns `{ action: "handled" }`. It never relies on throwing because Pi treats `input` exceptions as fail-open.
- Successful streaming transforms are passed directly to Pi's native `steer` or `followUp` queue. The plugin does not track queue entries, correlate messages, deduplicate submissions or intercept dequeue.
- Active compaction remains guarded before TUI submit through public terminal-input/editor-text APIs, using Pi lifecycle events to track compaction completion. The guard consumes only image-bearing submit attempts and leaves ordinary editing available.
- No prepared ledger, queue identifier, image provenance, session counter, historical reattachment, model-switch guard or image-specific persistence is maintained.
- The plugin does not delete Pi-owned temporary clipboard files.
- No third-party runtime dependency is required.
- Package and root documentation record the private path heuristic, supported formats, idle/streaming behavior, compaction guard, pre-enqueue failure semantics, lossy dequeue boundary, post-queue model-switch boundary, marker semantics and verification commands.

## Testing Decisions

- The primary automated seam remains the package-level extension scenario harness using the real Pi 0.84.3 input/image contracts and a fake TUI context. It exercises the public `input` transform result rather than private queue internals.
- Path tests cover canonical Windows/POSIX forms, temp directories with spaces, punctuation boundaries, near-match suffixes, GIF, arbitrary paths, and actual `crypto.randomUUID()` basenames.
- Happy-path scenarios cover idle, `steer` and `followUp` submissions for PNG/JPEG/WebP, path-only input, surrounding text, handwritten `[Image]`, handwritten backtick-wrapped `[Image]`, existing input images, and transformed message shape.
- Multi-image scenarios cover mixed formats, textual order, repeated identical paths, one marker per occurrence, and normalization reuse without attachment deduplication in every accepted submission mode.
- Failure scenarios cover missing/unreadable files, content-signature mismatch, malformed images, `resizeImage()` returning `null`, unsupported current models, abort, and unexpected errors. Streaming failures must assert exact Image Draft restoration and no transformed queue result.
- Queue-isolation scenarios cover text-only `steer`/`followUp` passthrough and multiple independent image transforms without plugin-owned queue state.
- Compaction scenarios continue to prove that image-bearing submit and follow-up keys are consumed only while compaction is active, while text-only compaction input and ordinary editing pass through.
- Mode-isolation scenarios cover RPC, extension source, JSON/print, CLI-style existing images, GIF, arbitrary paths, and unknown markers.
- A dedicated regression proves thrown processing errors are converted to `action: "handled"` so raw paths cannot fail open to the provider.
- Real TUI smoke runs with normal installed extensions, including `pi-fff`. It verifies both `steer` and `followUp` normal delivery, multiple queued messages, marker-plus-ImageContent session shape, accepted lossy dequeue behavior, the active-compaction guard, and post-queue switching to a text-only model.
- Model behavior is evidence only: a correct image response is useful, but the queued/session user message structure is the normal-delivery authority.
- Declared `check` and `test`, frozen lockfile validation, package loading checks, and `git diff --check` must pass. No installation command is run unless explicitly requested.

## Out of Scope

- Stable or numbered Image References.
- Hiding or replacing image paths while editing.
- Image previews or custom editor rendering.
- Generic conversion of arbitrary user-typed image paths.
- Plugin-managed GIF attachment or animation preservation.
- Image delivery through Pi's active-compaction text queue.
- Lossless dequeue, Esc or abort recovery for Image Attachments.
- Prepared ledgers, queue identifiers, queue correlation, plugin-owned queue ordering or queue lifecycle interception.
- Blocking model switches, restoring queued images after a model switch, or bypassing Pi's unsupported-image downgrade so an upstream provider can reject the payload.
- Modifying Pi host contracts or raising the minimum Pi version for queue support.
- Persisting queued Image Attachments, image provenance, pending paths, counters, or an image library across process restarts.
- Automatically reattaching historical images.
- Guaranteeing that a model never calls `read` or another tool.
- Reimplementing platform clipboard access.
- Deleting Pi-owned temporary files.
- Configurable marker text, compression settings, limits, or failure policy in P0.
- Publishing or installing the package.

## Further Notes

- Canonical domain vocabulary is defined by `packages/image-input/CONTEXT.md`.
- Pi's image content contract is the flat `type`, base64 `data`, and `mimeType` representation.
- npm verification during specification work confirmed `@earendil-works/pi-coding-agent@0.84.3` is the current latest release.
- Pi 0.84.3 retains ImageContent in native `steer` and `followUp` queues, but its public queue mirrors and dequeue result contain text only. Transforming Clipboard Image Paths to a backtick-wrapped `[Image]` therefore makes queue recovery intentionally lossy.
- Pi checks model image capability again before provider serialization. If the active model no longer supports images, Pi replaces them with an omitted placeholder before the upstream provider sees the request.
- The accepted queue-loss boundaries are deliberate complexity tradeoffs, not guarantees that images can later be recovered from Image Markers.
- The original stable-reference design was dropped after real TUI validation showed editor-factory conflicts with installed `pi-fff`. The bridge continues to avoid that integration surface.
- Pi already normalizes CLI images, built-in read results, and tool-result images at their own ingress points. This extension adds normalization only for supported TUI Clipboard Image Paths.
- No ADR is required for P0; this specification records the user-visible queue tradeoffs directly.
