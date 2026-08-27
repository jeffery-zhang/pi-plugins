# 01 - 单图 Clipboard Image Attachment Bridge

Type: task
Status: ready-for-agent
Blocked by: 00

Spec: [TUI Clipboard Image Attachment Bridge](../spec.md)

## Outcome

将现有 editor-based 实现改为无 custom editor 的提交时转换链路：一条 idle TUI prompt 中的单个 canonical PNG/JPEG/WebP clipboard path 在提交文本中变为 `[Image]`，对应规范化 ImageContent 与同一条 user message 一起交付。

## Acceptance Criteria

- [ ] 扩展不调用 `setEditorComponent()`，不包装 editor，也不读取系统剪贴板。
- [ ] Pi 原生 editor 在提交前继续显示临时路径，`pi-fff` autocomplete 和其他 editor 行为不受影响。
- [ ] 仅 TUI interactive `input` 中直接位于 `os.tmpdir()`、basename 符合 `pi-clipboard-<uuid>`、后缀为 PNG/JPG/JPEG/WebP 的路径被识别。
- [ ] 单个 eligible path 按内容签名校验并通过 Pi `resizeImage()` 规范化。
- [ ] 成功 transform 将该路径原位置替换为 `[Image]`，并追加 flat ImageContent。
- [ ] path-only 输入允许提交为 `[Image]` text content 加一张 ImageContent。
- [ ] 已有 `event.images` 原样保留在前，插件图片追加在后。
- [ ] 成功 user message 和 session history 不包含已转换的临时路径。
- [ ] GIF、任意普通路径、非 canonical 临时路径和手写 `[Image]` 保持普通文本行为。
- [ ] Pi 0.84.3 runtime guard、标准私有 ESM 包结构、peer dependency 和 lockfile importer 保持有效。
- [ ] 包 README 与根 README 改为 Attachment Bridge 语义，不再声明 stable references。
- [ ] 自动场景覆盖单张 PNG/JPEG/WebP、path-only、周围文本、已有图片和 passthrough。
- [ ] `check`、`test`、frozen lockfile 和 `git diff --check` 通过。
