# Context Map

## Contexts

- [OA Compaction](./packages/native-compaction/CONTEXT.md): integrates a Compact-Compatible Upstream while preserving portable Pi session behavior.
- [Image Input](./packages/image-input/CONTEXT.md): converts Pi-native TUI clipboard image paths into image attachments at submission.

## Relationships

- OA Compaction and Image Input are independent Pi extension contexts. They share the Pi host and repository engineering conventions, but no domain state or terminology.
- Packages without context-specific language do not require a `CONTEXT.md`; add one lazily when their first domain term is resolved.
