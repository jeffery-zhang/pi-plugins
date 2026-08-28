# 06 — Streaming Image Attachment Queue Delivery

**What to build:** Allow a TUI user to submit a supported Image Draft through Pi's native `steer` and `followUp` paths. Each accepted Clipboard Image Path is prepared before queueing, replaced by an Image Marker, and delivered with its Image Attachment when Pi consumes the queued user message. Preserve the active-compaction guard and explicitly retain Pi's lossy dequeue and post-queue model-switch behavior without adding plugin-owned queue state.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] An interactive TUI Image Draft submitted with `streamingBehavior: "steer"` is transformed to Image Markers plus Image Attachments instead of being restored and blocked.
- [x] An interactive TUI Image Draft submitted with `streamingBehavior: "followUp"` receives the same successful transformation.
- [x] Idle, `steer`, and `followUp` submissions share the existing PNG/JPEG/WebP, occurrence ordering, duplicate occurrence, existing-image ordering, normalization, and all-or-nothing contracts.
- [x] Image preparation finishes before queue acceptance; read, signature, normalization, cancellation, unexpected, and unsupported-current-model failures block the entire submission and restore the original Image Draft.
- [x] Multiple, duplicate, and mixed text/image submissions continue through Pi's native queues without a plugin limit, deduplication rule, queue ordering rule, prepared ledger, or persistent queue state.
- [x] Text-only `steer` and `followUp` input retains Pi's existing passthrough behavior.
- [x] Active compaction continues to block image-bearing submit and follow-up actions before they enter Pi's text-only compaction queue, while text-only compaction input remains unchanged.
- [x] RPC, extension-source, JSON, print, CLI-style images, arbitrary paths, GIF paths, and handwritten Image Markers retain their existing behavior.
- [x] Documentation states that dequeue, Esc, and abort restore only transformed Image Marker text and can lose queued Image Attachments.
- [x] Documentation states that switching to a text-only model after queueing may cause Pi to replace an Image Attachment with its unsupported-image placeholder before the upstream provider request.
- [x] The implementation does not add a custom editor, model-switch guard, host contract change, queue identifier, image provenance, or cross-process recovery.
- [x] Automated scenarios cover successful and failed `steer`/`followUp` transforms, multi-image ordering, text-only passthrough, mode isolation, and the unchanged compaction lifecycle guard.
- [x] Real TUI smoke with normal installed extensions verifies successful `steer` and `followUp` delivery as Image Marker plus Image Attachment, multiple queued messages, accepted lossy dequeue, active-compaction blocking, and the documented text-only-model boundary.
- [x] Package checks, tests, frozen lockfile validation, extension loading checks, and `git diff --check` pass; no installation command is run unless explicitly requested.
- [x] Package and root documentation are synchronized with the new queue behavior and verification evidence.

## Comments

Implementation completed in `packages/image-input`: interactive idle, `steer`, and `followUp` inputs now share the same pre-delivery image transform and fail-closed restoration path, while active compaction remains guarded before input handling. The extension still owns no queue state.

Automated verification passed: package `check`, 24 package tests, frozen offline lockfile install, normal and isolated extension loading checks, and `git diff --check`. Manual TUI verification also passed for streaming `steer` and `followUp`, multiple queued messages, lossy dequeue, active-compaction blocking, and the post-queue text-only-model boundary.

## Answer

Image Input now prepares canonical PNG/JPEG/WebP Clipboard Image Paths before Pi accepts idle, `steer`, or `followUp` input, then returns Image Markers plus ordered Image Attachments through Pi's native delivery path. Failures restore the exact Image Draft, active compaction remains guarded, and the extension adds no editor replacement or queue-owned state.

All automated checks and the required real-TUI smoke passed. The documented lossy dequeue and post-queue model-switch behavior matches Pi 0.84.3's native boundaries.
