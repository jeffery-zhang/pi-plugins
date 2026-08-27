# Image Input

Image Input stages local images while a user composes a message and delivers those images with stable, user-visible references in the same conversation.

## Language

**Image Draft**:
The active user draft containing zero or more image references. Its pending images remain editable until the draft is successfully submitted or discarded.

**Staged Image**:
A local image captured for an Image Draft but not yet delivered to the model.
_Avoid_: Uploaded image, pasted file

**Image Reference**:
A session-scoped stable label such as `[Image #7]` that identifies one staged or delivered image. References increase monotonically within a session and are never renumbered.
_Avoid_: Image index, attachment number

**Pending Image**:
A Staged Image whose Image Reference remains in the active Image Draft. Removing the final occurrence of its reference cancels that pending image.

**Image Attachment**:
The normalized image delivered with the user message and retained in conversation history. Attachments are ordered by Image Reference number; a model infers the association from message context and order, and the plugin does not guarantee that interpretation.
_Avoid_: Image mapping

**Available Image**:
An Image Attachment that remains in the model's active context. An Image Reference can outlive image availability after conversation compaction.
_Avoid_: Stored image, permanent image
