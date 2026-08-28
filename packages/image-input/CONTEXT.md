# Image Input

Image Input converts Pi-native TUI clipboard image paths into image attachments when a user submits an idle, `steer`, or `followUp` draft. It leaves editor presentation, platform clipboard behavior, and queued-message scheduling to Pi.

## Language

**Image Draft**:
The active TUI draft containing zero or more clipboard image paths before submission.
_Avoid_: Image state, staged prompt

**Clipboard Image Path**:
A temporary local path created by Pi's native clipboard flow for a pasted image. Only canonical Pi clipboard paths are eligible for conversion.
_Avoid_: Uploaded image, arbitrary image path

**Image Marker**:
The unnumbered `[Image]` token that replaces one clipboard image path in submitted text. A marker records position only; it has no stable identity and does not retrieve historical images.
_Avoid_: Image Reference, image index

**Image Attachment**:
The normalized image content delivered with a user message and retained in conversation history. Plugin-created attachments follow clipboard image path occurrence order.
_Avoid_: Read result, image mapping
