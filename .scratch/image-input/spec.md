# TUI Image Input with Stable References

Status: ready-for-agent

## Problem Statement

Pi 的 TUI 在用户粘贴图片时，会先将剪贴板图片写为本地临时文件，再把临时路径插入编辑器。用户看到的是冗长路径，无法自然地在草稿中把不同图片称为 `Image 1`、`Image 2`。提交后，路径只是普通文本，模型是否调用 `read` 读取图片取决于模型自行判断，因此图片不一定与用户说明在同一条用户消息中交付。

Image Input 需要把这条 TUI 专属路径升级为稳定的 Image Reference，并在提交入口把对应 Staged Image 规范化为 Image Attachment。用户应能在编辑时看到 `[Image #N]`，用自然语言引用图片，并确信提交成功时图片已经进入同一条用户消息和会话历史。RPC、CLI 和不受支持的图片格式继续使用 Pi 原有输入行为。

## Solution

提供一个支持 Pi 0.84.3 及以上版本的 TUI 专属扩展。扩展复用 Pi 原生剪贴板与临时文件处理，在编辑器观察到 Pi 生成的 PNG、JPEG 或 WebP 临时路径后，将其替换为 session 范围内单调递增的 Image Reference。扩展维护当前 Image Draft、Pending Image 和 prepared queue 状态，但不重新实现任何平台剪贴板逻辑，也不持久化 Image Reference provenance。

提交交互输入时，扩展通过 `input` 生命周期处理当前 Image Draft：按 Image Reference 数字排序，读取并校验 Staged Image，使用 Pi 公开的图片规格化能力处理图片，再把结果作为 Image Attachment 与原文本一起交付。会话历史保存 Image Reference 和规范化后的图片，不保存插件拥有的临时路径。

插件不向模型注入显式的 Image Reference 到附件映射。模型根据用户文本、上下文和附件顺序自行理解 `Image 1` 等引用；该关联是尽力而为，不构成准确性保证。

## P0 Product Decisions

- 最低兼容版本为 `@earendil-works/pi-coding-agent@0.84.3`。更早版本不受支持；实现使用 0.84.3 新增的 `session_compact_failed` 生命周期事件，不保留 0.84.2 compaction workaround。
- 插件接受 `<os.tmpdir()>/pi-clipboard-<uuid>.<ext>` 作为版本绑定的 Pi TUI 兼容约定。该文件名不是 Pi 的稳定公开 API，必须由自动检查和真实 TUI 冒烟保护。
- P0 只接管 PNG、JPEG 和 WebP。GIF 不生成 Image Reference，保持 Pi 插入的普通文件路径，并沿用 Pi 原有路径文本行为。
- 只有插件当前已知状态中的 Image Reference 才控制图片。手写的未知 `[Image #N]` 是普通文本，不创建附件，也不单独持久化 provenance。
- resume/fork 的后续编号通过当前 branch 中带图片附件的历史 user message 尽力恢复。文本消息中的手写 token 被忽略；手写 token 与其他来源图片出现在同一历史消息时不保证来源判定准确。
- 正常 steer 和 follow-up 支持图片。进入 prepared/queued 状态的 Image Reference 由该提交独占，直到交付、dequeue 或丢弃。
- 编辑期间 token 暂时消失只使对应图片 dormant。移动或 undo 恢复 token 后仍使用原身份；提交或明确丢弃草稿时才最终释放未引用映射。
- active Image Draft 优先于 compaction。尚未经过 `input` 处理的图片草稿会取消或阻止 compaction；已经带附件进入 Pi 正常 steer/follow-up queue 的提交不阻止 compaction。

## User Stories

1. As a TUI user, I want a pasted supported image to appear as `[Image #N]` while I am editing, so that the draft remains readable.
2. As a TUI user, I want the temporary filesystem path hidden from a supported Image Draft, so that implementation details do not distract from my instruction.
3. As a TUI user, I want Image Reference numbers to increase monotonically within a session and not be reused after successful delivery.
4. As a TUI user, I want a new session to begin at `Image #1` and a resumed/forked branch to continue after its recoverable historical maximum.
5. As a TUI user, I want moving, copying, deleting, and undoing Image Reference tokens to preserve predictable image identity and attachment count.
6. As a TUI user, I want unknown `[Image #N]` text and natural-language phrases such as `参考 Image 1` to remain ordinary instructions.
7. As a TUI user, I want supported pasted images delivered in the same user message as my instruction and ordered by Image Reference number.
8. As a TUI user, I want normalized Image Attachments retained in conversation history so resume and fork can replay submitted messages.
9. As a TUI user, I want image read, validation, normalization, unsupported-model, and active-compaction failures to block the whole Image Draft and preserve it for retry.
10. As a TUI user, I want a concise TUI error identifying the Image Reference that blocked submission.
11. As a TUI user, I want text-only drafts to retain Pi's existing behavior.
12. As a TUI user, I want streaming Enter and Alt+Enter flows to process images consistently through steer and follow-up.
13. As a TUI user, I want dequeue and abort restoration to reconstruct images from plugin-owned queued state even though Pi restores only text.
14. As a TUI user, I want unsent Image References restored to temporary paths before reload or session replacement so the draft remains recoverable.
15. As a TUI user, I accept that an unsent Image Reference may receive a new number after reload because pending provenance is not persisted.
16. As a TUI user, I do not want historical images automatically reattached when I mention an old Image Reference later.
17. As a TUI user, I want GIF input left as Pi's ordinary file path because GIF attachment handling is outside P0.
18. As an RPC client or CLI user, I want existing path text, image payloads, steer/follow-up behavior, and `@file` preprocessing left unchanged.
19. As an extension author, I want Image Input to reuse Pi's native clipboard path behavior instead of duplicating platform clipboard implementations.
20. As a maintainer, I want behavior expressed using the Image Input glossary and verified through public editor, input, and session lifecycle behavior.

## Implementation Decisions

- The feature is an independent private ESM Pi package with the repository's standard package shape and explicit extension entry point.
- The package keeps Pi-owned peer dependency versions as `"*"` per repository convention, but checks Pi's exported `VERSION` at runtime. On versions below 0.84.3 it remains inert and emits one concise TUI warning.
- TUI-only operations are guarded by `ctx.mode === "tui"`; core input handling also requires `event.source === "interactive"`. RPC, extension, JSON, print, and CLI-originated behavior is unchanged.
- The extension installs a component derived from Pi's `CustomEditor` and preserves built-in shortcuts, autocomplete, history, submit, interrupt, image paste, and extension shortcuts.
- Editor reconciliation covers `handleInput()` for user edits, `insertTextAtCursor()` for Pi's native image paste, and `setText()` for dequeue and lifecycle restoration. The implementation must not assume all changes pass through `handleInput()`.
- A Pi clipboard path is eligible only when it is located directly beneath the operating-system temporary directory, its basename matches the canonical UUID convention, and its suffix is PNG, JPG/JPEG, or WebP. Arbitrary paths and GIF paths are not converted.
- The clipboard path convention is treated as a compatibility heuristic rather than a public Pi API. No clipboard bytes are read independently by the plugin.
- Image Reference allocation skips unknown reference numbers already present in the active draft so a hand-written token is not captured by a later paste. Once a number is backed by live plugin state, every matching occurrence in that Image Draft refers to the same image.
- The session counter is in memory. On session start, resume, fork, or reload it is reconstructed from the highest reference in image-bearing user messages on the active branch. No custom session entry is written for counter or provenance.
- Pending mappings remain dormant while their final token is absent during editing. Only referenced mappings participate in submission; dormant mappings are released when the draft is submitted, discarded, or invalidated by lifecycle replacement.
- Before image preflight begins, the custom editor temporarily blocks further input. On success it unlocks normally. On failure it restores the exact Image Draft before unlocking, then shows a concise error.
- The `input` handler catches every image-processing failure itself. It restores the draft, notifies the TUI, and returns `{ action: "handled" }`; it never relies on throwing, because Pi treats `input` handler exceptions as non-blocking extension errors.
- Existing `event.images` not owned by the Image Draft are preserved byte-for-byte and placed before plugin-created attachments. Plugin-created attachments are appended in ascending Image Reference order.
- Each referenced Staged Image must exist, be readable, and have PNG, JPEG, or WebP content verified from file signatures rather than suffix alone.
- Each Staged Image is normalized once with Pi's public `resizeImage()` defaults. A `null` result is a submission-blocking normalization failure.
- The submitted text retains Image References and excludes plugin-owned temporary paths. The associated user message retains flat `{ type: "image", data, mimeType }` Image Attachments.
- No explicit model-visible mapping between Image References and attachment positions is injected.
- Prepared/queued state retains the Staged Image mapping until the corresponding user `message_start`. Queue ownership is exclusive; the same queued reference is not recognized as an active reference in another draft.
- Delivery confirmation uses prepared FIFO order, Image Reference set, and attachment count rather than exact text, because skill and prompt-template expansion occurs after `input`.
- On dequeue, Pi restores text through the editor. The plugin reconciles that text with its prepared ledger and reactivates the matching Image Draft; it does not depend on Pi returning queued images.
- Retry after a committed user message uses the Image Attachment already held by Pi and does not re-read or re-normalize the Staged Image.
- `session_before_compact` cancels compaction when the editor contains an active Image Draft. If compaction started before the draft acquired images, image submission is blocked until `session_compact` or `session_compact_failed`. Prepared messages already in Pi's normal queue do not block compaction.
- Image-bearing drafts never enter Pi's special compaction text queue.
- Before reload, new session, resume, fork, tree switch, or extension replacement invalidates pending editor state, known Image Reference tokens are restored to their original temporary paths. A replacement extension instance may allocate new numbers.
- Submitted references remain visible after their Image Attachment leaves active context. The plugin does not automatically reattach historical images or guarantee image availability after compaction.
- The plugin does not delete Pi-owned temporary clipboard files.
- The implementation uses Node.js standard library and Pi's exported APIs, with no third-party runtime dependency in P0.
- Package documentation records the private clipboard compatibility assumption, minimum Pi version, GIF behavior, failure semantics, queue limitations, reload renumbering, and verification commands. The repository README is updated when implementation is added.

## Testing Decisions

- The primary automated seam is one package-level extension scenario harness. It loads the extension against a fake Pi 0.84.3 host/TUI context and asserts externally visible editor, input, message, notification, and lifecycle behavior.
- The completed [host contract spike](./host-contract-spike.md) is the evidence baseline for editor observation, input fail-open behavior, queue text-only restoration, compaction events, and image normalization.
- Editor scenarios cover native-style `insertTextAtCursor()`, host `setText()`, normal typing, deletion, movement, duplicate tokens, undo, dequeue restoration, and temporary preflight locking.
- Reference scenarios cover one image, multiple images, monotonic numbering, unknown-token collision skipping, hand-written text-only history, image-bearing history recovery, new session reset, resume, and fork.
- Submission scenarios assert that successful messages retain Image References, preserve pre-existing input images, append normalized plugin images in numeric order, and exclude temporary paths.
- Failure scenarios cover missing and unreadable files, MIME mismatch, malformed PNG/JPEG/WebP, normalization returning `null`, unsupported models, active compaction, and unexpected handler errors. Every scenario asserts all-or-nothing submission, exact draft restoration, and user-visible feedback.
- A dedicated fail-open regression proves that image-processing exceptions are converted into `action: "handled"` rather than reaching the model.
- Queue scenarios cover steer, follow-up, exclusive reference ownership, FIFO/reference-set confirmation, skill/template expansion, dequeue, abort, retry, and compaction while a prepared image message is queued.
- Lifecycle scenarios cover successful cleanup, reload path restoration and possible renumbering, new/resume/fork/tree replacement, idempotent cleanup, and submitted-image behavior after compaction.
- Mode isolation scenarios assert that RPC, extension, JSON, print, CLI-style pre-existing images, arbitrary paths, GIF paths, and unknown references remain unchanged.
- Compatibility scenarios verify that Pi 0.84.3 exposes `session_compact_failed`, that versions below 0.84.3 leave the plugin inert, and that the canonical clipboard-path heuristic still matches real TUI output.
- Image normalization assertions focus on observable dimensions, MIME, valid base64, and limits rather than exact codec bytes.
- The package adds the smallest independent `check` and `test` setup needed for these scenarios; no repository-wide test framework is introduced.
- Real TUI smoke verification covers single/multiple PNG, JPEG, and WebP paste, streaming steer/follow-up, dequeue, unsupported model, compaction success/failure/cancel, reload/session switch, and GIF path passthrough.
- No installation command is run unless explicitly requested.

## Out of Scope

- Pi 0.84.2 and earlier compatibility.
- Modifying RPC path text, RPC image payloads, RPC steer, or RPC follow-up behavior.
- Replacing or extending CLI `@file` image preprocessing.
- Generic detection or conversion of arbitrary image paths typed by the user.
- Plugin-managed GIF staging, normalization, attachment, or animation preservation.
- Reimplementing platform clipboard access.
- Treating the private `pi-clipboard-*` filename as a guaranteed Pi API beyond the tested compatibility range.
- Persisting Image Reference provenance, pending local paths, or a cross-session image counter in custom session entries.
- Perfectly distinguishing a hand-written reference from a plugin reference when both appear in the same historical multimodal user message.
- Injecting an explicit Image Reference-to-attachment mapping for the model or guaranteeing model-side association.
- Automatically reattaching historical images or preserving image availability after compaction removes an attachment from active context.
- Creating a persistent image library or deleting Pi-owned temporary files.
- Rendering bitmap previews inside the editor.
- Configurable compression dimensions, quality, size limits, numbering format, or failure policy in P0.
- Supporting image-bearing submissions through Pi's special compaction text queue.
- Composing with arbitrary third-party custom editor implementations in P0.
- Publishing or installing the package.

## Further Notes

- The canonical vocabulary is defined by the Image Input context: Image Draft, Staged Image, Image Reference, Pending Image, Image Attachment, and Available Image.
- The implementation baseline is Pi 0.84.3, whose `session_compact_failed` event closes the compaction failure/cancellation lifecycle gap found in 0.84.2.
- The actual Pi image content contract is the flat `type`, base64 `data`, and `mimeType` representation. Documentation examples using a nested source object do not override the installed type contract.
- Pi already normalizes CLI image files, built-in read results, and tool-result images at their respective ingress points. This extension adds ingress normalization only for Image Attachments created from supported TUI clipboard paths.
- No ADR is required for P0: the decisions are isolated to this extension and recorded here with their accepted compatibility limitations.
