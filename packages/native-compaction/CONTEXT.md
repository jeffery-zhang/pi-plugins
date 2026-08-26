# OA Compaction

This context defines language for integrating OpenAI-compatible upstream context compaction while preserving Pi session portability.

## Language

**Compact-Compatible Upstream**:
An upstream model service that implements the OpenAI Responses `/responses/compact` request contract and accepts the returned canonical output in subsequent Responses requests.
_Avoid_: Compact provider, remote compactor

**Native Compaction**:
Pi's built-in text-summarization compaction path.
_Avoid_: OA Compaction, remote summary

**OA Compaction**:
Context compaction performed through a Compact-Compatible Upstream's OpenAI Responses `/responses/compact` contract.
_Avoid_: Native Compaction, Codex compaction, remote summary

**OA Checkpoint**:
The complete opaque canonical output returned by OA Compaction and replayed unchanged in subsequent compatible Responses requests.
_Avoid_: Native Checkpoint, compact summary, native summary

**Text Fallback**:
A human-readable Pi-compatible compaction summary retained as the portable representation when an OA Checkpoint cannot be used.
_Avoid_: OA Checkpoint, opaque summary
