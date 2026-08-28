# @jingoz/pi-image-input

Pi TUI Clipboard Image Attachment Bridge for Pi 0.84.3 and newer.

## Install

```bash
pi install npm:@jingoz/pi-image-input
```

## Behavior

- Pi's native TUI editor remains the editor; this extension does not call `setEditorComponent()` or replace `pi-fff`.
- Pi continues to own clipboard access and writes the pasted image path into the editor. The original path remains visible until submission.
- On an idle, native `steer`, or native `followUp` interactive TUI `input` event, every canonical clipboard image path is read, validated by content signature, normalized with Pi's public `resizeImage()` defaults, replaced in place by `[Image]`, and appended as a flat image attachment in occurrence order.
- Existing `event.images` are preserved first; plugin images follow in occurrence order.
- Repeated paths produce repeated markers and attachments. Their normalized data may be reused within the submission, but attachments are not deduplicated.
- The selected model must support image input. Any read, signature, normalization, cancellation, or model-capability failure blocks the whole prompt, restores the original path-bearing draft, and reports an error.
- Clipboard image drafts are accepted while Pi is idle and through Pi's native streaming `steer` and `followUp` paths. Image preparation completes before Pi accepts the input; the extension does not track, reorder, deduplicate, or persist queued messages.
- Active compaction still blocks image-bearing submit and follow-up actions before they enter Pi's text-only compaction queue, while text-only input retains Pi's normal behavior.
- The compaction submit guard uses current Pi keybindings and is installed and removed with the TUI session lifecycle.
- GIF paths, ordinary paths, noncanonical paths, and handwritten `[Image]` text pass through unchanged.
- RPC, extension-source, JSON, print, and CLI-style inputs retain Pi's existing behavior.
- The extension does not delete Pi-owned temporary files or persist paths, counters, provenance, or historical image mappings.

`[Image]` records text position only. It does not provide a stable image identity and does not prevent a model from choosing to call tools for other reasons. Successful conversion means the image is already included in the same user message as native image content.

Queued image recovery follows Pi's native behavior. Dequeue, Esc, or abort can restore only the transformed `[Image]` text and lose the queued Image Attachments. Switching to a text-only model after queueing can cause Pi to replace an Image Attachment with its unsupported-image placeholder before the upstream provider request. This extension does not add recovery or model-switch state.

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

## Local Development

```bash
pnpm --filter @jingoz/pi-image-input check
pnpm --filter @jingoz/pi-image-input test
pnpm install --frozen-lockfile --offline
pi -e ./packages/image-input --list-models
pi --no-extensions -e ./packages/image-input --list-models
```

Automated coverage currently runs on Windows with Pi 0.84.3 and covers PNG, JPEG, WebP, idle/steer/follow-up transforms, multi-image order, duplicate occurrences, GIF passthrough, failure restoration, unsupported models, aborts, compaction lifecycle, and non-TUI isolation. A 2501x1 PNG regression proves that the bridge calls Pi's default `resizeImage()` path: the delivered attachment is 2000x1 and differs from the source bytes.

Normal installed-extension and isolated package loading were verified. Manual Windows TUI smoke passed in the normal installed-extension environment, including `pi-fff`. It covered idle and streaming `steer`/`followUp` delivery, multiple queued messages, `[Image]` plus flat ImageContent session shape, accepted lossy dequeue behavior, active-compaction blocking, the unsupported-current-model guard, and the post-queue text-only-model boundary. WSL, X11/Wayland, macOS, and providers outside the tested Windows environment were not tested.
