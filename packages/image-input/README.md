# @jingoz/pi-image-input

Pi TUI Clipboard Image Attachment Bridge for Pi 0.84.3 and newer.

## Install

```bash
pi install npm:@jingoz/pi-image-input
```

## Behavior

- Pi continues to own clipboard access. Its pasted PNG/JPEG/WebP paths immediately appear as `[Image 1]`, `[Image 2]`, etc. in the TUI editor, and keep those labels in submitted messages.
- The extension wraps the existing editor factory, or uses Pi's `CustomEditor` when none is installed. It preserves the editor's callbacks, shortcuts, cursor handling, undo, and autocomplete provider. Current official `@ff-labs/pi-fff` uses the separate autocomplete API and works in either loading order.
- On an idle, native `steer`, or native `followUp` interactive TUI `input` event, every known marker or canonical clipboard image path is read, validated by content signature, normalized with Pi's public `resizeImage()` defaults, and appended as a flat image attachment in occurrence order.
- Existing `event.images` are preserved first; plugin images follow in occurrence order.
- The same clipboard path reuses its number. Repeated occurrences still produce repeated attachments; their normalized data may be reused within the submission.
- The selected model must support image input. Any read, signature, normalization, cancellation, or model-capability failure blocks the whole prompt, restores the draft with its numbered markers, and reports an error.
- Clipboard image drafts are accepted while Pi is idle and through Pi's native streaming `steer` and `followUp` paths. Image preparation completes before Pi accepts the input; the extension does not track, reorder, deduplicate, or persist queued messages.
- Active compaction still blocks image-bearing submit and follow-up actions before they enter Pi's text-only compaction queue, while text-only input retains Pi's normal behavior.
- The compaction submit guard uses current Pi keybindings and is installed and removed with the TUI session lifecycle.
- GIF paths, ordinary paths, noncanonical paths, and unknown markers pass through unchanged. A known `[Image N]` in the current input context refers to its clipboard image.
- RPC, extension-source, JSON, print, and CLI-style inputs retain Pi's existing behavior.
- Image paths remain in memory and are discarded on reload or shutdown. Only the next image number is stored as a custom session entry, preventing an old marker from silently referring to a different image after reload. Pi-owned temporary files are not deleted.
- Shutdown restores the previous editor and expands remaining draft markers back to paths. An editor installed later by another extension is left selected.

Image numbers identify clipboard files within the current input context, rather than attachment positions in a message. Successful conversion means the image is included in the same user message as native image content; the marker does not prevent a model from choosing to call tools for other reasons.

Dequeue, Esc, or abort can restore marker text without its queued attachments. While the same extension instance and clipboard files remain available, submitting a known marker prepares the image again. Reloaded or resumed sessions cannot recover old images from marker text alone. Switching to a text-only model after queueing retains Pi's native unsupported-image behavior.

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

Automated coverage runs on Windows with Pi 0.84.3 and 1.4.0 and covers PNG, JPEG, WebP, numbered editor presentation, editor composition and cleanup, adjacent markers, marker recovery, image-number persistence, idle/steer/follow-up transforms, multi-image order, duplicate occurrences, GIF passthrough, failure restoration, unsupported models, aborts, compaction lifecycle, and non-TUI isolation. A 2501x1 PNG regression verifies Pi's default resizing to 2000x1.

Pi 1.4.0 runtime checks with official `@ff-labs/pi-fff@0.11.0` and `@jingoz/pi-purge` pass in both loading orders, including actual FFF autocomplete suggestions and image-preserving prompt transforms. A real Windows TUI check using `pi -e ./packages/image-input` confirms a canonical path set through the editor API renders as `[Image 1]` and Enter delivers the numbered text plus ImageContent. This check does not read the system clipboard or make a provider request. WSL, X11/Wayland, macOS, other custom-editor extensions, and provider image delivery were not revalidated for this change.
