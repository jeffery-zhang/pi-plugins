# Image Input

This context defines language for staging local images and delivering them to a model as part of the current user message.

## Language

**Same-Turn Image Attachment**:
A local image delivered to the model in the same user message that submits it, without requiring a later file-read action.
_Avoid_: Image read, deferred image, image path prompt

**Balanced Image Policy**:
The default image policy that preserves ordinary screenshot and photo readability while reducing unnecessarily large pixel dimensions and request payloads.
_Avoid_: Lossless mode, low-detail mode, token guarantee

**Original Image Policy**:
An opt-in image policy that preserves source dimensions and image representation whenever the model accepts them, while still enforcing validation and request safety limits. Unsupported representations may be normalized without resizing.
_Avoid_: Unlimited mode, lossless guarantee, unvalidated image

**Staged Image**:
A local image selected in the TUI draft and awaiting delivery as a Same-Turn Image Attachment.
_Avoid_: Pending attachment, queued path, pasted image

**Image Marker**:
Numbered user-message text such as `[Image 1]` that represents a Staged Image in the draft and identifies the corresponding Same-Turn Image Attachment to both the model and the TUI transcript. Numbers are allocated monotonically within one draft, are never reused or changed, and reset for the next user message.
_Avoid_: Image placeholder, preview, attachment indicator

**Image Reference**:
An explicit `@` reference to a local image path that creates a Staged Image.
_Avoid_: File mention, image path prompt

**Clipboard Bitmap**:
Image pixel data placed on the system clipboard, such as the result of a system screenshot.
_Avoid_: Clipboard file, pasted path

**Clipboard File**:
A local image file represented as an operating-system clipboard file-list item after being copied in a file manager.
_Avoid_: Clipboard bitmap, pasted path

**Partial Image Submission**:
A user message in which valid Staged Images are delivered and each failed image is replaced by an explicit unavailable marker retaining its original Image Marker number.
_Avoid_: Best-effort attachment, silent image omission, partial rollback
