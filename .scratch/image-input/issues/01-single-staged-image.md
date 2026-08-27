# 01 - Pi 0.84.3 基线与单图纵向链路

Type: task
Status: ready-for-agent
Blocked by: 00

Spec: [TUI Image Input with Stable References](../spec.md)

## Outcome

建立 Image Input 包并交付一张受支持 TUI 剪贴板图片的完整路径：Pi 插入的临时路径在 editor 中变为 `[Image #1]`，提交时变为同一条 user message 中的规范化 Image Attachment。同步把仓库插件兼容基线提升到 Pi 0.84.3。

## Acceptance Criteria

- [ ] `AGENTS.md` 与 `docs/research/pi-plugin-development.md` 的 Pi 兼容基线更新为已验证的 0.84.3，并记录 `session_compact_failed` 是升级原因。
- [ ] `packages/image-input/` 具备标准私有 ESM 包结构、显式 `pi.extensions` 入口以及可运行的 `check`/`test` 命令。
- [ ] Pi 自带导入继续使用版本为 `"*"` 的 peer dependencies；运行时检测 Pi `VERSION`，低于 0.84.3 时保持 inert，并在 TUI 中只提示一次。
- [ ] 新包加入仓库时同步更新根 README；包文档记录最低版本、支持格式和验证命令。
- [ ] 自定义 editor 基于 Pi `CustomEditor`，保留默认快捷键、自动补全、历史、提交、中断和原生图片粘贴行为。
- [ ] editor 能从 `insertTextAtCursor()` 和 `setText()` 观察 host 写入，并通过正常编辑路径保持状态同步。
- [ ] 仅直接位于系统临时目录、basename 符合 `pi-clipboard-<uuid>` 且后缀为 PNG、JPG/JPEG 或 WebP 的路径会变为 `[Image #1]`。
- [ ] GIF、任意普通路径、非规范剪贴板路径和未知 `[Image #N]` 保持原样；插件不自行读取平台剪贴板。
- [ ] interactive `input` 提交已知 `[Image #1]` 时按内容签名验证图片，通过 Pi `resizeImage()` 规范化，并追加 flat Image Attachment。
- [ ] 提交文本和持久化 user message 保留 `[Image #1]`，不包含该 Staged Image 的临时路径。
- [ ] 已存在于 `event.images` 的图片保持原顺序和内容，插件图片追加在其后；text-only 输入保持原行为。
- [ ] 自动场景覆盖单张 PNG/JPEG/WebP 的 editor staging 和成功提交，以及 GIF/普通路径/text-only passthrough。
- [ ] 使用 `pi -e ./packages/image-input` 完成至少一张真实 TUI 图片的粘贴、显示、提交和 session message 检查；不执行安装。
