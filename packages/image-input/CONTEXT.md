# Image Input

Image Input presents Pi-native clipboard images as numbered markers while the user edits a TUI draft, then delivers image attachments through idle, `steer`, or `followUp` submission. Pi owns clipboard access and queued-message scheduling.

## Language

**Image Draft**:
The active TUI draft containing zero or more Image Markers or Clipboard Image Paths before submission.
_Avoid_: Image state, staged prompt

**Clipboard Image Path**:
A temporary local path created by Pi's native clipboard flow for a pasted image. Only canonical Pi clipboard paths are eligible for conversion.
_Avoid_: Uploaded image, arbitrary image path

**Image Marker**:
The numbered label `[Image N]` identifies one clipboard image in the current input context and appears in both the Image Draft and submitted text. The same Clipboard Image Path keeps its label, and numbers are not reused for different images within a Pi session. A label cannot retrieve a historical image after its input context has ended.
_Avoid_: Image Reference, image index

**Image Attachment**:
The normalized image content delivered with a user message and retained in conversation history. Plugin-created attachments follow clipboard image path occurrence order.
_Avoid_: Read result, image mapping
