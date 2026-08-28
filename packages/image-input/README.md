# @pi-plugins/image-input

Pi TUI Clipboard Image Attachment Bridge for Pi 0.84.3 and newer.

## Behavior

- Pi native TUI editor remains the editor; this extension does not call `setEditorComponent()`.
- Pi continues to own clipboard access and writes the pasted image path into the editor.
- On an idle interactive TUI `input` event, every canonical clipboard image path is read, validated by content signature, normalized with Pi's public `resizeImage()` defaults, replaced in place by `[Image]`, and appended as a flat image attachment in occurrence order.
- Existing `event.images` are preserved first; plugin images follow in occurrence order.
- Repeated paths produce repeated markers and attachments. Their normalized data may be reused within the submission, but attachments are not deduplicated.
- The selected model must support image input. Any read, signature, normalization, cancellation, or model-capability failure blocks the whole prompt, restores the original path-bearing draft, and reports an error.
- Clipboard image drafts are accepted only while Pi is idle. Streaming steer/follow-up and active-compaction submissions are blocked while text-only input retains Pi's normal queue behavior.
- The compaction submit guard uses current Pi keybindings and is installed and removed with the TUI session lifecycle.
- GIF paths, ordinary paths, noncanonical paths, and handwritten `[Image]` text pass through unchanged.

## Path Contract

The recognized path must be directly under `os.tmpdir()` with basename:

```text
pi-clipboard-<uuid>.png
pi-clipboard-<uuid>.jpg
pi-clipboard-<uuid>.jpeg
pi-clipboard-<uuid>.webp
```

The path must have safe textual boundaries: it is not converted when embedded in a longer path-like token or followed by path-name characters.

## Runtime Guard

Pi versions below `0.84.3` keep the extension inert. In TUI mode the extension emits one concise warning.

## Verification

```bash
pnpm --filter @pi-plugins/image-input check
pnpm --filter @pi-plugins/image-input test
```
