# @pi-plugins/image-input

Pi TUI Clipboard Image Attachment Bridge for Pi 0.84.3 and newer.

## Behavior

- Pi's native TUI editor remains the editor; this extension does not call `setEditorComponent()` or replace `pi-fff`.
- Pi continues to own clipboard access and writes the pasted image path into the editor. The original path remains visible until submission.
- On an idle interactive TUI `input` event, every canonical clipboard image path is read, validated by content signature, normalized with Pi's public `resizeImage()` defaults, replaced in place by `[Image]`, and appended as a flat image attachment in occurrence order.
- Existing `event.images` are preserved first; plugin images follow in occurrence order.
- Repeated paths produce repeated markers and attachments. Their normalized data may be reused within the submission, but attachments are not deduplicated.
- The selected model must support image input. Any read, signature, normalization, cancellation, or model-capability failure blocks the whole prompt, restores the original path-bearing draft, and reports an error.
- Clipboard image drafts are accepted only while Pi is idle. Streaming steer/follow-up and active-compaction submissions are blocked while text-only input retains Pi's normal queue behavior.
- The compaction submit guard uses current Pi keybindings and is installed and removed with the TUI session lifecycle.
- GIF paths, ordinary paths, noncanonical paths, and handwritten `[Image]` text pass through unchanged.
- RPC, extension-source, JSON, print, and CLI-style inputs retain Pi's existing behavior.
- The extension does not delete Pi-owned temporary files or persist paths, counters, provenance, or historical image mappings.

`[Image]` records text position only. It does not provide a stable image identity and does not prevent a model from choosing to call tools for other reasons. Successful conversion means the image is already included in the same user message as native image content.

## Path Contract

The recognized path must be directly under `os.tmpdir()` with basename:

```text
pi-clipboard-<uuid>.png
pi-clipboard-<uuid>.jpg
pi-clipboard-<uuid>.jpeg
pi-clipboard-<uuid>.webp
```

The path must have safe textual boundaries: it is not converted when embedded in a longer path-like token, URI-like prefix, Windows alternate data stream, or filename suffix.

## Runtime Guard

Pi versions below `0.84.3` keep the extension inert. In TUI mode the extension emits one concise warning.

## Verification

```bash
pnpm --filter @pi-plugins/image-input check
pnpm --filter @pi-plugins/image-input test
pnpm install --frozen-lockfile --offline
pi -e ./packages/image-input --list-models
pi --no-extensions -e ./packages/image-input --list-models
```

Automated coverage currently runs on Windows with Pi 0.84.3 and covers PNG, JPEG, WebP, multi-image order, duplicate occurrences, GIF passthrough, failure restoration, unsupported models, aborts, streaming, compaction lifecycle, and non-TUI isolation. A 2501x1 PNG regression proves that the bridge calls Pi's default `resizeImage()` path: the delivered attachment is 2000x1 and differs from the source bytes.

Normal installed-extension and isolated package loading were verified. Manual Windows TUI smoke was completed in the normal installed-extension environment, including `pi-fff`, using `muryo/gemini-3.7-flash-tiered` for image delivery and `muryo/deepseek-v4-flash` for the unsupported-model guard. The session result confirmed `[Image]` text without converted clipboard paths and flat ImageContent in the same user message. WSL, X11/Wayland, macOS, and providers outside `muryo` were not tested.
