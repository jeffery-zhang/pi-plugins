# Context Map

## Contexts

- [OA Compaction](./packages/native-compaction/CONTEXT.md): integrates a Compact-Compatible Upstream while preserving portable Pi session behavior.
- [Image Input](./packages/image-input/CONTEXT.md): presents clipboard images as numbered markers during editing and delivers image attachments at submission.
- [Pi Purge](./packages/pi-purge/CONTEXT.md): adjusts model behavior in user-defined content scenarios while preserving Pi coding capabilities; DS is the first required validation target.

## Relationships

- OA Compaction, Image Input, and Pi Purge are independent Pi extension contexts. They share the Pi host and repository engineering conventions, but no domain state or terminology.
- Packages without context-specific language do not require a `CONTEXT.md`; add one lazily when their first domain term is resolved.
