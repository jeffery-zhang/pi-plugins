# Pi Plugins

A workspace for Pi extensions.

## Packages

- `@jingoz/pi-win-notify`: Windows-only TUI task completion Toast displaying `Pi` and `Task completed · <current directory basename>`. See [packages/win-notify](packages/win-notify/README.md).
- `@jingoz/pi-questionnaire`: TUI questionnaire tool. See [packages/questionnaire](packages/questionnaire/README.md).
- `@jingoz/pi-image-input`: Pi 0.84.3+ TUI clipboard bridge for idle and native streaming `steer`/`followUp` PNG/JPEG/WebP submissions. It keeps native editor paths visible until submit, prepares images before queue acceptance, replaces converted occurrences with a backtick-wrapped `[Image]` marker, fails closed with draft restoration, and leaves queue ownership and non-TUI input unchanged. Queued dequeue/abort recovery is intentionally text-only. See [packages/image-input](packages/image-input/README.md).
