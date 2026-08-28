# 03 - 失败关闭与原始草稿恢复

Type: task
Status: resolved
Blocked by: 02

Spec: [TUI Clipboard Image Attachment Bridge](../spec.md)

## Outcome

确保 Image Draft 只有在所有 eligible paths 都能作为 ImageContent 完整交付时才提交。任何转换或模型能力失败都阻止整条消息，并把含原始路径的草稿恢复到当前 editor。

## Acceptance Criteria

- [x] 当前模型未声明 image input 时阻止包含 eligible paths 的提交。
- [x] 文件不存在、不可读、内容签名不符、内容损坏或 `resizeImage()` 返回 `null` 时阻止提交。
- [x] AbortSignal 在读取和处理路径中被尊重；取消不会继续提交。
- [x] 多图采用全有或全无语义，任意一张失败时不发送文本或部分图片。
- [x] 失败后通过公共 TUI editor API 恢复提交前的完整原始文本，包括所有临时路径和光标无关内容。
- [x] 每个失败路径给出简洁、可定位到路径 basename 或全局原因的 TUI 错误。
- [x] `input` handler 捕获所有预期和意外处理错误，恢复草稿并返回 `{ action: "handled" }`。
- [x] 自动回归证明底层或 UI 抛错时 raw clipboard path 不会 fail open 到 provider。
- [x] text-only、GIF、普通路径和不含 eligible path 的输入不进入失败守卫。
- [x] 自动场景覆盖单图和多图失败、模型能力、取消、意外异常、原始草稿恢复和 provider 未调用。

## Answer

Image Draft 现采用 fail-closed 语义。扩展在 I/O 前验证当前模型 image capability，逐图读取、签名校验和规范化，并在读取与规范化边界尊重 AbortSignal。任一图片或全局能力失败都会阻止整条提交，通过 `ctx.ui.setEditorText()` 恢复完整原稿并通知错误；恢复或通知 API 自身抛错也不会让 raw path 放行。

验证通过：`pnpm --filter @jingoz/pi-image-input check`、`pnpm --filter @jingoz/pi-image-input test`（16/16）和 `git diff --check`。
