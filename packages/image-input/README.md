# @pi-plugins/image-input

Pi TUI Clipboard Image Attachment Bridge for Pi 0.84.3 and newer.

## Behavior

- Pi native TUI editor remains the editor; this extension does not call `setEditorComponent()`.
- Pi continues to own clipboard access and writes the pasted image path into the editor.
- On an idle interactive TUI `input` event, one canonical clipboard image path is read, validated by content signature, normalized with Pi's public `resizeImage()` defaults, replaced by `[Image]`, and appended as a flat image attachment.
- Existing `event.images` are preserved first; the plugin image follows.
- GIF paths, ordinary paths, noncanonical paths, and handwritten `[Image]` text pass through unchanged.
- If an input contains more than one eligible path, issue 01 leaves the whole input unchanged to avoid partial conversion.

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
