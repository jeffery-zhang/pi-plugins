# Pi Plugins

This context defines shared language for Pi plugins that integrate provider-native context compaction while preserving Pi session portability.

## Language

**Compact-Compatible Upstream**:
An upstream model service that implements the OpenAI Responses `/responses/compact` request contract and accepts the returned canonical output in subsequent Responses requests.
_Avoid_: Compact provider, remote compactor

**Native Compaction**:
Context compaction performed through a Compact-Compatible Upstream rather than Pi's text summarization path.
_Avoid_: Remote summary

**Native Checkpoint**:
The opaque canonical output returned by Native Compaction and replayed unchanged in subsequent compatible Responses requests.
_Avoid_: Compact summary, native summary

**Text Fallback**:
A human-readable Pi compaction summary retained as the portable representation when a Native Checkpoint cannot be used.
_Avoid_: Native checkpoint, opaque summary
