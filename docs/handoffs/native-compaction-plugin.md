# Handoff: Provider-Native Compaction Plugin

## Objective

Continue designing and then implement a generic Pi plugin that prefers an upstream implementing the OpenAI Responses `/responses/compact` contract and silently falls back to Pi's built-in text summarization when the native attempt is inapplicable or fails before commit.

No plugin implementation exists yet. The repository is currently an initial workspace skeleton.

## Repository Context

- Follow `AGENTS.md` and `docs/research/pi-plugin-development.md` before changing anything under `packages/`.
- The compatibility baseline is `@earendil-works/pi-coding-agent@0.84.2`.
- Canonical domain terms are already recorded in `CONTEXT.md`; use those terms rather than redefining them here.
- Pi's relevant installed documentation is `docs/compaction.md`, `docs/extensions.md`, `docs/session-format.md`, and `docs/custom-provider.md` under the installed `@earendil-works/pi-coding-agent` package.

## Confirmed Direction

- "Generic" means provider-name-independent support for upstreams implementing the OpenAI Responses compact contract. It does not mean abstracting arbitrary vendor-specific compaction protocols.
- Capability detection must not rely on hard-coded provider names.
- The likely applicability gate is an OpenAI Responses-compatible Pi API plus an actual compact request whose response schema is validated and whose capability result is cached.
- A separate probe is not required: the real compact request can establish support.
- Pi's pre-commit fallback is straightforward: a `session_before_compact` handler returns `undefined` after a non-abort native failure, allowing Pi to run its built-in summarization with the currently selected local or remote model.
- Native success requires more than returning a Pi compaction result. Every later compatible provider request must replay the stored canonical compact output before messages created after the checkpoint.
- The Native Checkpoint is the complete `compacted.output[]`, not only the `type: "compaction"` item. It must be persisted and replayed unchanged. OpenAI says not to prune the returned compacted window.
- The compact response envelope has `id`, `object: "response.compaction"`, `created_at`, `output`, and `usage`. A compaction item has `id`, `type: "compaction"`, `encrypted_content`, and optional `created_by`.
- Pi's `CompactionResult` still requires `summary: string`; provider-native state can be stored in `CompactionEntry.details`.

## Expected Extension Surfaces

- `session_before_compact`: build the full Responses compact input, call `/responses/compact`, validate the canonical output, and return a Pi compaction entry. Return `undefined` on eligible pre-commit fallback errors; preserve user cancellation.
- `context`: suppress Pi's textual checkpoint and pre-checkpoint retained context when a compatible Native Checkpoint will be replayed.
- `before_provider_request`: prepend the stored canonical `output[]` to the final Responses `payload.input`, followed by only post-checkpoint messages.
- `session_start`: restore checkpoint metadata from the active branch's compaction `details`.

## Unresolved P0 Design

- The user confirmed that fallback after native success matters, but the representation/cost policy was not finalized before pausing the grilling process.
- Decide whether the default mode eagerly creates both a Native Checkpoint and a real Text Fallback. This is robust but normally requires a second model summarization call because returning custom compaction bypasses Pi's default summarizer.
- Alternatively, design a reliable lazy reconstruction path from retained session entries. A placeholder `summary` alone is not a safe fallback.
- Define behavior after model/provider/base URL/instructions incompatibility or `invalid_encrypted_content` during replay.

## Implementation Risks

- Pi's generic message and compaction types do not natively represent OpenAI compaction items.
- Converting Pi history into lossless Responses input must preserve messages, tool calls/results, reasoning signatures, images, and instructions.
- The compact endpoint URL can vary across compatible gateways; derive it from resolved auth/base URL but allow an explicit override.
- Opaque checkpoint compatibility may depend on provider, endpoint, model family, instructions, and gateway routing. Persist fingerprints and never inject into a clearly incompatible request.
- Do not log API credentials, full request content, or `encrypted_content`. Pass the compaction event's `AbortSignal` through network I/O.

## Primary References

- OpenAI compaction guide: https://developers.openai.com/api/docs/guides/compaction
- OpenAI compact API reference: https://developers.openai.com/api/reference/resources/beta/subresources/responses/methods/compact
- OpenAI Python `CompactedResponse`: https://github.com/openai/openai-python/blob/main/src/openai/types/responses/compacted_response.py
- OpenAI Python `ResponseCompactionItem`: https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_compaction_item.py
- Sub2API compact account/routing work: https://github.com/Wei-Shaw/sub2api/pull/1555

## Suggested Skills

The next agent should call the Skill tool for:

- `research` before freezing the endpoint schema and supported-model assumptions against current primary sources.
- `codebase-design` to choose the checkpoint persistence/replay boundary without coupling the whole extension to provider internals.
- `domain-modeling` when the unresolved fallback and compatibility terms are settled; update `CONTEXT.md` inline.
- `tdd` when implementation begins, especially for native success, unsupported endpoint fallback, abort, resume, model switching, malformed output, and replay failure.
- `grilling` only after the user says the design is ready to stress-test; the user explicitly paused grilling in this session.

## Next Step

Resume with a short discussion of the success-path representation: whether `summary` is eagerly generated as a portable fallback or whether a durable lazy fallback can be designed without a second summarization call. Do not begin implementation until that behavior is explicit.
