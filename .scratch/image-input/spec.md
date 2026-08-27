# TUI Image Input with Stable References

Status: ready-for-agent

## Problem Statement

Pi 的 TUI 在用户粘贴图片时，会先将剪贴板图片写为本地临时文件，再把临时路径插入编辑器。用户看到的是冗长路径，无法自然地在草稿中把不同图片称为 `Image 1`、`Image 2`。提交后，路径只是普通文本，模型是否调用 `read` 读取图片取决于模型自行判断，因此图片不一定与用户说明在同一条用户消息中交付。

Image Input 需要把这条 TUI 专属路径升级为稳定的 Image Reference，并在提交入口把对应 Staged Image 规范化为 Image Attachment。用户应能在编辑时看到 `[Image #N]`，用自然语言引用图片，并确信提交成功时图片已经进入同一条用户消息和会话历史。RPC 和 CLI 已有输入契约不得被插件改变。

## Solution

提供一个 TUI 专属的 Pi 扩展。扩展复用 Pi 原生剪贴板与临时文件处理，在编辑器观察到 Pi 生成的图片路径后，将其替换为 session 范围内稳定、单调递增的 Image Reference。扩展维护当前 Image Draft 的 Pending Image 状态，但不重新实现任何平台剪贴板逻辑。

提交交互输入时，扩展通过 `input` 生命周期处理当前 Image Draft：按 Image Reference 数字排序，读取并校验 Staged Image，使用 Pi 公开的图片规格化能力压缩图片，并把结果作为 Image Attachment 与原文本一起交付。会话历史保存 Image Reference 和压缩后的图片，不保存临时路径。

插件不向模型注入显式的 Image Reference 到附件映射。模型根据用户文本、上下文和附件顺序自行理解 `Image 1` 等引用；该关联是尽力而为，不构成准确性保证。

## User Stories

1. As a TUI user, I want a pasted image to appear as `[Image #N]` while I am editing, so that the draft remains readable.
2. As a TUI user, I want the temporary filesystem path hidden from my draft, so that implementation details do not distract from my instruction.
3. As a TUI user, I want each pasted image to receive a stable session-scoped number, so that I can refer to it unambiguously in later text.
4. As a TUI user, I want image numbers to increase monotonically within a session, so that previously used references are not reused.
5. As a TUI user, I want a new session to begin again at `Image #1`, so that numbering has a clear lifecycle.
6. As a returning user, I want a resumed session to continue after its highest historical Image Reference, so that new references do not collide with existing ones.
7. As a TUI user, I want moving `[Image #N]` inside my draft not to change its number, so that references already written elsewhere remain valid.
8. As a TUI user, I want deleting the final occurrence of `[Image #N]` to cancel that Pending Image, so that removed images are not silently sent.
9. As a TUI user, I want copying an existing `[Image #N]` token to continue referring to the same Pending Image, so that the same image is not uploaded twice.
10. As a TUI user, I want manually typed unknown `[Image #N]` text to remain ordinary text, so that the plugin does not fabricate attachments.
11. As a TUI user, I want natural-language phrases such as `参考 Image 1` to remain ordinary instructions, so that the model can interpret them without plugin-specific rewriting.
12. As a TUI user, I want pasted images delivered in the same user message as my instruction, so that the model can reason about the text and images together.
13. As a TUI user, I want multiple Image Attachments ordered by their Image Reference number, so that their presentation is deterministic.
14. As a TUI user, I want the model to infer the relationship between my references and attachments, so that no verbose mapping text is added to my prompt.
15. As a TUI user, I accept that model-side image association is best effort, so that the plugin can remain lightweight.
16. As a TUI user, I want images normalized before they enter conversation history, so that repeated model requests do not repeatedly compress the same image.
17. As a TUI user, I want conversation history to retain the normalized Image Attachment, so that resume and fork can replay the submitted message.
18. As a TUI user, I want temporary image paths excluded from model context and persisted messages, so that machine-local details are not leaked unnecessarily.
19. As a TUI user, I want image read, validation, or normalization failures to block submission, so that the model never answers as if a missing image had been delivered.
20. As a TUI user, I want a blocked submission to preserve my Image Draft, so that I can retry without reconstructing the prompt.
21. As a TUI user, I want a clear TUI error when image processing fails, so that I know which image prevented submission.
22. As a TUI user, I want submission blocked when the selected model does not support image input, so that Pi does not downgrade my image silently.
23. As a TUI user, I want an Image Draft with Pending Images blocked during conversation compaction, so that queued text cannot bypass image processing.
24. As a TUI user, I want ordinary text-only drafts to retain Pi's existing behavior, so that the plugin does not affect unrelated prompts.
25. As a TUI user, I want normal streaming Enter and Alt+Enter flows to process Pending Images, so that steer and follow-up composition behave consistently.
26. As a TUI user, I want dequeue and retry flows to retain enough pending state to reconstruct an image draft when Pi restores its text, so that an interrupted queued prompt does not lose its images.
27. As a TUI user, I want unsent Image References restored to temporary paths before extension reload or session replacement, so that an in-progress draft does not become irrecoverable.
28. As a TUI user, I want successfully submitted Pending Image state released while the session counter continues increasing, so that stale local paths are not retained unnecessarily.
29. As a TUI user, I understand that an Image Reference can outlive an Available Image after compaction, so that the plugin does not pretend to be a permanent image store.
30. As a TUI user, I do not want old images automatically reattached when I mention their Image Reference later, so that historical prompts are not silently expanded.
31. As an RPC client author, I want RPC path text and RPC image payloads left unchanged, so that the extension does not alter the RPC contract.
32. As a CLI user, I want `@file` image handling left unchanged, so that Pi's existing CLI preprocessing remains authoritative.
33. As an extension author, I want Image Input to reuse Pi's native clipboard path behavior, so that Windows, WSL, Wayland, X11, and other platform handling are not duplicated.
34. As a maintainer, I want plugin state and behavior expressed using the Image Input glossary, so that future changes preserve the same domain boundaries.
35. As a maintainer, I want the feature verified through the public editor and `input` behaviors, so that tests remain stable across internal refactors.

## Implementation Decisions

- The feature will be implemented as an independent private Pi extension package in the Image Input context, using the repository's standard package shape and explicit extension entry point.
- The extension will be TUI-aware but will register its core lifecycle and input behavior through Pi's public extension API. TUI-only editor operations must be guarded by TUI mode checks.
- The extension will install a custom editor component derived from Pi's `CustomEditor` so built-in application shortcuts, autocomplete, history, submission, interrupt handling, and other editor behavior remain intact.
- The custom editor will not read the clipboard itself. It will let Pi's native paste flow create and insert a temporary image path, then recognize only canonical Pi clipboard image paths and replace them with Image References.
- Recognition is restricted to files beneath the current operating-system temporary directory whose basename follows Pi's `pi-clipboard-<uuid>` convention and whose supported image suffix is PNG, JPEG, WebP, or GIF. Arbitrary user paths are not converted.
- An Image Reference is generated only by the plugin and is backed by session-local state. A manually typed reference with no known state is ordinary text.
- Image Reference numbers are monotonically increasing for the current session and are never renumbered. Reordering or duplicating a token does not change the referenced identity.
- A new session resets the next Image Reference to 1. Resume, fork, and extension initialization recover the next number by finding the maximum historical Image Reference visible in that session.
- The active Image Draft owns Pending Images. Removing the final occurrence of an Image Reference cancels its Pending Image; duplicate occurrences continue to point to one Staged Image and produce one Image Attachment.
- The extension will process only `input` events whose source is interactive and which contain known Pending Image references. RPC and extension-originated input are returned unchanged.
- Existing CLI image attachments and any pre-existing input images not owned by the active Image Draft are not normalized or rewritten by this plugin.
- Before accepting an Image Draft, the extension will verify that Pi is not compacting and that the selected model advertises image support.
- Each referenced Staged Image must still exist, be readable, and match a supported image MIME type based on content rather than filename alone.
- The extension will normalize each Staged Image with Pi's public image resize capability and its default compatibility limits. The plugin will not introduce a separate compression policy or user configuration in P0.
- Image Attachments are appended in ascending Image Reference order, regardless of the current textual order of their tokens.
- The submitted text retains Image References and excludes temporary paths. The associated user message retains the normalized Image Attachments.
- No explicit model-visible mapping between Image References and attachment positions will be injected. Model interpretation is intentionally best effort.
- A processing failure, unsupported model, or compaction state fails closed: no partial subset of images is submitted, the full draft remains available, and the user receives a concise error.
- The plugin will distinguish prepared/queued image state from committed image state. Pending local state is released only when the host has accepted the corresponding user message; it remains recoverable for dequeue, retry, or preflight failure.
- Normal TUI streaming submission through `prompt` with steer or follow-up behavior is supported because it passes through the `input` hook.
- Image-bearing drafts are not allowed into Pi's special compaction queue, whose restoration paths may bypass the `input` hook.
- Before reload, new session, resume, fork, tree switch, or extension replacement invalidates pending state, any unsent Image References in the editor are restored to their original temporary paths.
- Submitted Image References remain visible in history after their Image Attachment leaves active model context. The plugin does not automatically reattach historical images and does not guarantee references after compaction.
- The plugin does not delete Pi-owned temporary clipboard files. Their lifecycle remains owned by Pi and the operating system.
- The implementation will use Node.js standard library and Pi's exported APIs. No new third-party runtime dependency is required for P0.
- The package will document its behavior, limitations, and verification commands, and the repository README will be updated when the extension implementation is added.
- Long-lived resources are not expected. Any editor/listener registrations must still be detached or restored idempotently during session shutdown and extension replacement.

## Testing Decisions

- The primary automated seam is one package-level extension scenario harness. It loads the extension against a fake Pi host/TUI context, drives a canonical Pi clipboard path into the editor, observes the Image Reference, submits an interactive input event, and asserts the externally visible transformed text, Image Attachments, notifications, and retained draft behavior.
- Tests will prefer this high seam over direct tests of internal maps, counters, regular expressions, or helper functions. Internal organization may change as long as the extension's editor and input contracts remain unchanged.
- The same scenario seam will cover one image, multiple images, stable session numbering, deletion of the final token, duplicate tokens, token reordering, unknown manually typed references, and text-only drafts.
- Submission scenarios will assert that successful messages retain Image References, contain normalized image payloads ordered by reference number, and do not contain temporary paths.
- Failure scenarios will cover missing files, unreadable files, MIME mismatch, unsupported formats, normalization failure, unsupported models, and active compaction. Each must assert all-or-nothing submission, a retained Image Draft, and a user-visible error.
- Lifecycle scenarios will cover successful commit cleanup, preflight rejection, queue/dequeue restoration, session reset, resume counter recovery, reload restoration to paths, and session replacement.
- Mode isolation scenarios will assert that RPC input, extension-originated input, CLI-style pre-existing images, arbitrary filesystem paths, and unknown `[Image #N]` text remain unchanged.
- Image normalization assertions will focus on observable limits and valid image payloads, not exact encoded bytes, because codec output may vary across Pi/Photon versions.
- The repository currently has no automated test prior art for extension packages. The new package will therefore add the smallest runnable check/test setup that can exercise the scenario seam without introducing a repository-wide framework.
- Existing package structure and direct TypeScript extension loading provide prior art for package loading. Pi's public custom editor, input event, session lifecycle, and image resize APIs provide the behavioral contract under test.
- A real TUI smoke test will load the package with `pi -e`, paste one and multiple clipboard images, verify numbered placeholders during editing, submit a multimodal prompt, inspect the resulting session message, and exercise streaming steer/follow-up.
- Smoke verification will also select a non-image model, trigger compaction, and reload/switch sessions with an unsent Image Draft to verify the blocking and restoration paths.
- The package's declared `check` and `test` commands must pass before completion. No installation command will be run unless explicitly requested.

## Out of Scope

- Modifying RPC path text, RPC image payloads, RPC steer, or RPC follow-up behavior.
- Replacing or extending CLI `@file` image preprocessing.
- Generic detection or conversion of arbitrary image paths typed by the user.
- Reimplementing platform clipboard access.
- Injecting explicit Image Reference-to-attachment mapping text for the model.
- Guaranteeing that any provider or model associates an Image Reference with the intended attachment.
- Automatically reattaching an historical image when its Image Reference is mentioned later.
- Preserving image availability after Pi compaction removes the Image Attachment from active context.
- Creating a persistent image library, asset database, or cross-session numbering system.
- Deleting or garbage-collecting Pi's temporary clipboard files.
- Rendering bitmap previews inside the editor; the editor displays textual Image References only.
- Applying a global `before_provider_request` or context rewrite as a compression fallback.
- Configurable compression dimensions, quality, size limits, numbering format, or failure policy in P0.
- Supporting image-bearing submissions through Pi's special compaction queue.
- Publishing or installing the package.

## Further Notes

- The canonical domain vocabulary is defined by the Image Input context: Image Draft, Staged Image, Image Reference, Pending Image, Image Attachment, and Available Image.
- The repository research baseline currently records Pi 0.84.2, while the active local executable reports 0.84.3. Implementation must verify every required public API against the 0.84.2 compatibility baseline. Upgrading that baseline is a separate, explicitly validated change.
- The actual Pi image content contract is the flat `type`, base64 `data`, and `mimeType` representation. Documentation examples using a nested source object must not override the installed type contract.
- Pi already normalizes CLI image files, built-in read results, and tool-result images at their respective ingress points. This extension adds ingress normalization only for Image Attachments created from TUI clipboard paths.
- No ADR is required for P0: the decisions are recorded in this spec and remain reasonably reversible within the isolated extension context.
