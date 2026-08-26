# Integrated Pi Image Input P0

Status: ready-for-agent

## Problem Statement

Pi can read local images after the model chooses to call `read`, and its TUI can place a clipboard bitmap into a temporary file, but it does not provide a unified draft experience in which pasted, copied, dropped, or explicitly referenced local images become Same-Turn Image Attachments.

Users therefore see raw paths rather than stable image identities, cannot reliably tell which images will be sent, and may force the model to spend another tool call reading each image. Large source images can also consume unnecessary visual tokens and request bytes. Failures are especially risky when several images are involved because silent omission can make the model describe the wrong image.

P0 must make the TUI draft authoritative: every accepted local image is represented by a stable, model-visible Image Marker, and submitting the draft sends valid images in the same user message under a conservative Balanced Image Policy. The feature must not modify Pi core or take ownership of provider-specific payloads, historical images, or images supplied by other integrations.

## Solution

Provide one integrated Pi extension that owns local image staging, Image Marker lifecycle, validation, image budgeting, and the final `input` transform.

In TUI mode, users can create Staged Images by pasting a Clipboard Bitmap, copying and pasting image files on native Windows, pasting or dropping image paths, or selecting an Image Reference through `@` autocomplete. Each accepted image receives a stable marker such as `[Image 1]`. The marker remains ordinary user-message text, so both the TUI transcript and the model use the same identifier.

The extension submits valid images as `ImageContent` in marker-appearance order. A failed image does not block valid siblings: its marker is changed to an explicit unavailable marker, while successful images remain Same-Turn Image Attachments. A non-vision model blocks the entire image-bearing submission so the user cannot mistakenly believe the model saw the images.

Balanced Image Policy is the default. It limits each image to a 1,568 px longest edge and approximately 1.15 megapixels. Original Image Policy is available as a session-scoped opt-in and never silently falls back to Balanced Image Policy. Both policies enforce source safety limits, a per-attachment encoded budget, and a total message image budget.

## User Stories

1. As a Pi TUI user, I want a local image to be attached to my current user message, so that the model can inspect it without first calling `read`.
2. As a Pi TUI user, I want to paste a system screenshot from the Clipboard Bitmap, so that screenshots enter my draft with the platform-standard Pi paste shortcut.
3. As a native Windows user, I want to copy an image file in the file manager and paste it into Pi, so that I do not need to type its path.
4. As a native Windows user, I want to paste several copied image files at once, so that each accepted file becomes a separate Staged Image up to the message limit.
5. As a terminal user, I want to paste an image path, so that a path obtained from another program becomes a Staged Image.
6. As a terminal user, I want to drop an image path into the editor, so that terminal drag-and-drop follows the same behavior as a pasted path.
7. As a user, I want an input consisting only of an image path to be recognized automatically, so that Pi core clipboard temporary paths work without extra syntax.
8. As a user discussing a path in ordinary prose, I want the extension to leave it as text unless I use `@`, so that normal file discussions are not rewritten as attachments.
9. As a user, I want to select an image through `@` path autocomplete, so that the image is staged and replaced by an Image Marker immediately.
10. As a user, I want a manually entered valid Image Reference to be resolved at submission, so that attachment does not depend on autocomplete availability.
11. As a Windows user, I want quoted paths with spaces to work, so that common local file names are supported.
12. As a cross-platform user, I want POSIX paths, Windows paths, `file://` URLs, WSL paths, spaces, quotes, and Unicode names to resolve correctly where the referenced file is accessible.
13. As a user, I want every accepted image to appear in the draft as `[Image N]`, so that I know exactly what is staged.
14. As a user, I want Image Markers to remain in the submitted transcript, so that my later references and the model's answer use the same identifiers.
15. As a user, I want Image Marker numbers to remain stable after assignment, so that deleting or moving another image does not change an identifier I have already used in my prompt.
16. As a user, I want marker numbers to be allocated monotonically within a draft and never reused, so that a newly added image cannot inherit the identity of a deleted image.
17. As a user, I want the next user message to restart numbering at Image 1, so that identifiers remain local to one message.
18. As a user, I want deleting an Image Marker to remove the corresponding Staged Image, so that the visible draft is authoritative.
19. As a user, I want moving an Image Marker to move its attachment position without renumbering it, so that comparison order is under my control.
20. As a user, I want adding the same source image twice to produce two markers and two attachments, so that the extension does not silently reinterpret my intent.
21. As a user, I want the sixth image to be rejected before it receives a marker, so that a draft never appears capable of sending more than five images.
22. As a user, I want an invalid or oversized source to be rejected during staging when possible, so that I receive feedback before composing a long prompt around it.
23. As a user, I want valid sibling images to be sent when one staged image later becomes unreadable, so that one changed file does not discard the entire useful message.
24. As a user, I want a failed marker to become text such as `[Image 2 unavailable: unreadable image]`, so that neither I nor the model mistakes another attachment for Image 2.
25. As a user, I want unavailable reasons to avoid exposing full local paths, so that transcript and logs disclose no more filesystem information than necessary.
26. As a user, I want image processing to preserve the original marker number after a failure, so that valid and unavailable images remain unambiguous.
27. As a user, I want image-bearing submission to be blocked when the selected model lacks image input capability, so that I cannot accidentally receive a hallucinated visual analysis.
28. As a user, I want my draft and all Staged Images retained after a non-vision model gate, so that I can switch models and retry.
29. As a user, I want Balanced Image Policy enabled by default, so that ordinary screenshots and photos remain readable without sending unnecessary 4K pixels.
30. As a user, I want Balanced Image Policy to enforce both a longest-edge and total-pixel limit, so that square images do not bypass the intended visual budget.
31. As a user performing OCR or detail-sensitive work, I want to opt into Original Image Policy, so that source dimensions are preserved when they fit the safety limits.
32. As a user selecting Original Image Policy, I want an over-budget image to be marked unavailable instead of silently resized, so that policy semantics remain trustworthy.
33. As a user, I want to change the policy with `/image-mode balanced|original`, so that I have one explicit control without a second image-staging workflow.
34. As a user, I want image mode to return to `balanced` after reload or session replacement, so that an old `original` choice does not leak into unrelated work.
35. As a user, I want each final encoded attachment to stay within a provider-conscious safety budget, so that a single image is less likely to make the request fail.
36. As a user, I want the combined encoded image payload to stay below the common inline-request ceiling, so that five individually valid images cannot produce an invalid overall request.
37. As a user, I want JPEG, static PNG, WebP, GIF, and BMP sources to be recognized by content rather than extension alone, so that renamed non-images are rejected.
38. As a user, I want BMP normalized to a model-compatible format, so that a locally supported bitmap can still become an attachment.
39. As a user, I want an animated GIF to remain unchanged when it fits the budget, so that P0 does not silently flatten or re-encode its animation.
40. As a user, I want transparent static PNG content to retain transparency, so that screenshots and UI assets are not degraded by an implicit JPEG conversion.
41. As a user, I want EXIF-oriented images to be presented with the correct orientation when transformed, so that portrait photographs are not rotated incorrectly.
42. As a user, I want the extension never to overwrite my source image, so that optimization cannot damage local files.
43. As a user, I want all Staged Image state cleared after a successful or Partial Image Submission, so that images cannot leak into the next message.
44. As a user, I want unsent Staged Images cleared on `/new`, `/resume`, `/fork`, `/reload`, and exit, so that draft-local state cannot cross session lifecycles.
45. As a user, I want existing images supplied through Pi's input event to pass through unchanged, so that this extension does not take ownership of another integration's attachments.
46. As an RPC client, I want directly supplied image attachments to continue unchanged, so that P0 does not impose TUI staging semantics on RPC.
47. As a JSON or print-mode user, I want unsupported staging behavior to preserve my original text, so that a path is never silently swallowed when no draft UI exists.
48. As a Windows or WSL user, I want Pi's default `Alt+V` behavior retained, so that the extension does not require terminal keybinding changes.
49. As a macOS or Linux user, I want Pi's default `Ctrl+V` behavior retained, so that image paste follows the existing platform convention.
50. As a user, I want concise TUI feedback when staging or processing fails, so that I know whether an image will be sent.
51. As a security-conscious user, I want base64 image data excluded from logs and diagnostics, so that local visual content is not duplicated into log files.
52. As a maintainer, I want the P0 behavior verified through one draft-to-message seam, so that tests prove user-visible outcomes without depending on internal helper structure.

## Implementation Decisions

- The feature is one Pi extension with one owner for TUI draft state, one `input` handler, and one image-processing pipeline. Multiple cooperating extensions must not split marker ownership, queue ownership, and image transformation.
- Compatibility targets `@earendil-works/pi-coding-agent` 0.84.2. Development and smoke verification must also run against the repository's resolved 0.84.3 baseline.
- The extension remains a private ESM Pi package with an explicit extension entry and Pi-provided imports declared as peer dependencies.
- The primary external seam is the draft-to-message transformation. Given the current draft text, Staged Images, active model capability, current policy, existing images, and platform context, the module returns final user text, extension-produced `ImageContent`, user-visible diagnostics, and the resulting draft-state transition.
- TUI input adapters feed the primary module. They do not own image policy, numbering, limits, or submission behavior.
- Pi core remains the Clipboard Bitmap backend. The extension recognizes the temporary image path inserted by Pi and replaces that path with an Image Marker; it must not deep-import Pi's non-exported clipboard utilities or recreate cross-platform bitmap clipboard providers.
- Native Windows Clipboard File support uses a Windows-only adapter for operating-system file-list clipboard data. P0 does not add equivalent WSL, macOS, or Linux file-list adapters.
- Clipboard File input accepts image files only, preserves clipboard order, stages no more than the remaining per-message capacity, and reports rejected entries without assigning markers.
- The extension uses Pi's platform-standard image-paste action. It does not hard-bind `Ctrl+V` on Windows/WSL or attempt to bypass terminal-owned keybindings.
- Image Reference autocomplete presents eligible local image paths. Selecting a completion stages the image immediately and replaces the reference with an Image Marker.
- A submission-time fallback parses manually entered Image References. Bare path auto-detection is limited to pasted or dropped path input and input whose complete meaningful content is one or more image paths. Image-looking paths embedded in ordinary prose are not converted without `@`.
- Path handling supports accessible Windows and POSIX paths, WSL path forms, file URLs, quotes, escaped spaces, and Unicode. Resolution uses platform-aware path and URL operations rather than shell-string concatenation.
- A Staged Image stores a stable marker number and a source descriptor. It does not store base64 in editor text or logs.
- A draft starts marker allocation at 1. Marker numbers increase monotonically, are never reused, and reset only after the draft is finished or cleared.
- Image Marker text is part of the actual user message. The marker is not stripped before model submission.
- The extension tracks only markers it created. Unrelated text that resembles `[Image N]` does not gain attachment semantics.
- Removing a tracked marker removes its Staged Image. Reordering tracked markers changes the order of extension-produced attachment blocks while preserving each marker number.
- Adding the same path or identical bytes again creates a new Staged Image. No implicit path or content deduplication occurs.
- A draft supports at most five Staged Images. Attempts beyond five are rejected before marker allocation.
- Initial staging validation checks that path sources are readable ordinary files, source bytes do not exceed 20 MiB, declared dimensions do not exceed 40 megapixels, magic bytes identify a supported format, and the content can be decoded.
- Submission revalidates path-backed sources because files may change after staging. Clipboard Bitmap bytes already owned by the draft do not require a filesystem path to remain valid.
- Supported P0 sources are JPEG, non-animated PNG, WebP, GIF, and BMP. Detection is content-based. APNG and other formats are unsupported unless Pi's public stable image interface later provides an equivalent safe path.
- Balanced Image Policy limits the longest edge to 1,568 pixels and the output area to approximately 1.15 megapixels while preserving aspect ratio.
- Original Image Policy preserves dimensions and provider-supported encoding. Formats that cannot be sent directly, such as BMP, may be normalized to PNG without resizing.
- Both policies enforce an encoded base64 size ceiling of 4.5 MiB per extension-produced image and 18 MiB across all extension-produced images in one user message.
- The 4.5 MiB ceiling deliberately follows Pi's public resize helper default and leaves margin below common 5 MiB single-image limits. The 18 MiB total leaves room below common 20 MiB inline-request ceilings for text and serialization overhead.
- Images are processed in Image Marker appearance order. An image that cannot fit the per-image or remaining total budget becomes unavailable; later smaller images may still fit and be sent.
- Balanced processing may use Pi's public `resizeImage` export, but the extension must enforce the 1.15MP area policy rather than relying only on square maximum dimensions.
- Balanced processing must not flatten animated GIFs. A GIF that already fits all output budgets is passed through unchanged; otherwise its marker becomes unavailable.
- Transparent PNG output must remain transparency-capable. If it cannot fit the budget without losing transparency, its marker becomes unavailable rather than falling back to opaque JPEG.
- BMP output is normalized to PNG. Other provider-supported formats may be retained or safely re-encoded as long as dimensions, transparency, orientation, and budget invariants hold.
- The extension never writes transformed output over the source file.
- Before consuming an image-bearing draft, the extension checks `ctx.model` image capability. A missing or non-vision model causes a handled submission, restores or retains the draft, and reports the required model change.
- Submission uses Partial Image Submission for failures discovered after marker creation. Each failed marker becomes `[Image N unavailable: <safe reason>]`; successful markers stay unchanged and successful attachments are sent.
- Safe unavailable reasons describe the category, such as unreadable image, unsupported format, source too large, decode failed, or attachment budget exceeded. They do not contain base64 or full local paths.
- Once a normal or Partial Image Submission is accepted, all Staged Image state is cleared, including failed items. Failed items are not carried into the next draft.
- Extension-produced images are returned in Image Marker appearance order before untouched pre-existing `event.images`; pre-existing images retain their relative order and are not resized, relabeled, counted, or budgeted by this extension.
- The active image policy belongs to the current session runtime and defaults to Balanced Image Policy. `/image-mode balanced|original` changes the policy used by subsequently created drafts.
- The mode command is the only P0 image command. Image staging uses paste, drop, bare whole-input paths, or Image References; marker deletion is the clear operation.
- Mode and draft state are in memory only. Session replacement, reload, shutdown, and a completed submission clear state; replacement and reload restore Balanced Image Policy.
- Full staging behavior is TUI-only. RPC-provided images pass through unchanged. JSON and print modes do not create Staged Images; they preserve original text when staging cannot be performed.
- The extension does not promise exact provider token savings. Balanced Image Policy promises pixel and request-payload governance only.
- The extension must not log image data, clipboard contents, complete request bodies, or other sensitive payloads.
- Image-bearing mid-stream steering is not part of the P0 acceptance seam. It must not silently consume or lose the current Staged Image draft.

## Testing Decisions

- The main test seam is the extension's draft-to-message interface. Tests exercise complete user-visible transitions from staged inputs and draft text to final text, ordered images, diagnostics, and retained or cleared state.
- Tests should assert external behavior and invariants, not helper call counts, private module layout, Photon internals, worker creation, or a particular image library.
- A Pi extension-runtime harness should load the real extension factory, capture the registered input handler, command, autocomplete behavior, and lifecycle handlers, and drive them through representative contexts.
- TUI adapter tests should verify that Pi clipboard temporary paths, Windows Clipboard File results, pasted paths, dropped paths, and Image References all converge on the same Staged Image behavior.
- Path behavior must cover Windows, POSIX, WSL, and file URL forms; quoted and escaped spaces; Unicode; relative and absolute paths; inaccessible files; directories; missing files; and misleading file extensions.
- Marker tests must cover immediate insertion, monotonic allocation, deletion without renumbering, movement without renumbering, attachment reordering, no number reuse, per-message reset, unrelated marker-like text, and duplicate image additions.
- Submission tests must cover one through five successful images, rejection of the sixth image, source validation failures, files changed after staging, and state cleanup after normal and Partial Image Submission.
- Partial Image Submission tests must verify stable unavailable numbering, safe failure text, successful sibling attachment, later small-image admission after an earlier total-budget failure, and no failed-image carryover.
- Model-gate tests must cover a vision-capable model, a text-only model, and no selected model. Blocked submissions must retain text, markers, and Staged Images.
- Balanced Image Policy tests must verify both the 1,568 px longest-edge limit and the approximately 1.15MP area limit across landscape, portrait, and square fixtures.
- Original Image Policy tests must prove that dimensions are unchanged when budgets permit and that over-budget images become unavailable without Balanced fallback.
- Budget tests must exercise the 20 MiB source ceiling, 40MP decoded-dimension ceiling, 4.5 MiB encoded per-image ceiling, 18 MiB encoded total ceiling, and boundary values immediately below and above each limit.
- Format fixtures must include JPEG, static PNG, transparent PNG, WebP, GIF, BMP, EXIF rotation, malformed data with an image extension, and an unsupported APNG or equivalent unsupported format.
- GIF tests must prove pass-through when within budget and explicit unavailability when transformation would be required.
- Transparency tests must prove that Balanced processing never silently produces an opaque attachment from a transparent source.
- Existing-image tests must verify that pre-existing input images are unchanged, maintain relative order, and are placed after extension-produced images.
- Lifecycle tests must cover completed submission, `/new`, `/resume`, `/fork`, `/reload`, and shutdown. No Staged Image or non-default mode may leak into a replacement runtime.
- Mode tests must verify the default, valid mode changes, invalid arguments, and reset after reload or session replacement.
- Non-TUI tests must verify RPC pass-through and JSON/print preservation of original text without staging side effects.
- Logging tests must ensure diagnostics contain neither base64 data nor full clipboard payloads.
- Native Windows Clipboard File tests should be platform-conditional and exercise one file, several files, mixed image/non-image entries, Unicode paths, and capacity rejection.
- A manual TUI smoke test must run the package through `pi -e` on the resolved Pi baseline. It must exercise a system screenshot, a copied Windows image file, an Image Reference, marker deletion and movement, a vision-model submission, and a text-only-model gate.
- The smoke test must inspect the stored user message or provider-facing message to prove that images are `ImageContent` in the current user message rather than path text requiring a later `read` call.
- No live provider matrix is required for every automated run. Before release, at least one compatible visual model should verify the end-to-end attachment contract; broader OpenAI, Anthropic, and Gemini checks remain release validation rather than unit tests.

## Out of Scope

- Automatic or manual crop controls.
- Automatic subject detection, OCR-specific preprocessing, or line-art/photo classification.
- A `low` image policy.
- Historical image pruning, replacement, hashing, or context pixel budgets.
- OpenAI `detail`, Gemini `media_resolution`, or any provider-private request mutation.
- Vision-model handoff that replaces images with generated text descriptions.
- Terminal inline image previews, recent-image pickers, or image galleries.
- A second `/image-add` or `/image-clear` staging workflow.
- Cross-platform Clipboard File backends outside native Windows.
- Reimplementing Pi's cross-platform Clipboard Bitmap backend.
- Transforming, relabeling, deduplicating, or budgeting pre-existing `event.images`.
- Persisting image mode, local paths, staged bytes, or markers across reload or session replacement.
- Exact visual-token prediction or guaranteed provider cost savings.
- Mid-stream image steering guarantees.
- User cancellation after an `input` transform has begun; the public P0 input event provides no reliable cancellation signal.
- APNG optimization or preservation unless it becomes supported through Pi's public stable image interfaces.
- Publishing or installing the package.

## Further Notes

- Implementation is intentionally deferred. `ready-for-agent` means the requirements are complete, not that implementation should begin now.
- Pi 0.84.2 and the resolved 0.84.3 package publicly export `resizeImage`; deep imports into internal image or clipboard modules are unnecessary and unsupported.
- Pi core already owns platform Clipboard Bitmap acquisition and inserts a temporary image path into the editor. The extension should integrate at that path/editor seam instead of duplicating the core clipboard implementation.
- Pi's public resize helper prioritizes fitting pixel and encoded budgets; it does not guarantee JPEG quality 80 or a particular outbound encoding. Tests must assert the P0 invariants rather than a codec choice except where format preservation is itself required.
- Current `pi-image-tools` behavior remains useful prior art for marker-backed staged attachments, but its declared Pi peer range and broader preview/recent-picker scope are not the compatibility contract for this feature.
- No ADR is required for the P0 policy details: they are explicit in this spec and remain inexpensive to revise before implementation. The existing single-owner extension decision should only become an ADR if another implementation later proposes splitting marker, queue, and input ownership.
- When implementation begins, the package README and repository README must be updated together as required by the repository's Pi extension maintenance rules.
