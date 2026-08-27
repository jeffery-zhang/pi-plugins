# 05 - Session 边界、模式隔离与交付验证

Type: task
Status: ready-for-agent
Blocked by: 04

Spec: [TUI Image Input with Stable References](../spec.md)

## Outcome

完成 reload/session replacement 恢复、非 TUI 输入隔离、幂等清理、文档和最终验证，使整个 P0 可以按声明的 Pi 0.84.3+ 边界交付。

## Acceptance Criteria

- [ ] reload、new、resume、fork、tree switch 或 extension replacement 使 pending editor 状态失效前，known Image Reference token 被恢复成原始临时路径。
- [ ] replacement 后允许未提交路径获得新编号，不持久化 pending provenance，也不尝试重写用户自然语言中的旧编号。
- [ ] 生命周期恢复和清理幂等；重复事件不会重复附件、损坏 editor 文本或泄漏 prepared/dormant mapping。
- [ ] 插件不删除或垃圾回收 Pi 拥有的临时 clipboard 文件。
- [ ] 已提交 Image Reference 在 attachment 离开 active context 后仍保留历史文本，但插件不会因后续提及而自动重附图片。
- [ ] RPC path text、RPC image payload、RPC steer/follow-up 和 extension-source input 保持不变。
- [ ] CLI `@file` 产生的既有图片、任意普通路径、非 Pi clipboard 路径、GIF 路径和未知 Image Reference 保持不变。
- [ ] JSON、print 和无 TUI UI 场景不安装交互 editor，也不调用 TUI-only API。
- [ ] 实现只依赖 Node.js 标准库和 Pi 公开导出；私有 `pi-clipboard-*` 约定只用于路径识别，并有兼容测试和文档说明。
- [ ] package README 和根 README 说明最低 Pi 版本、PNG/JPEG/WebP 支持、GIF passthrough、失败语义、queue/dequeue、reload 重新编号、历史恢复限制和验证命令。
- [ ] package 声明的 `check` 与 `test` 全部通过，`git diff --check` 无错误。
- [ ] 真实 TUI 冒烟覆盖单图、多图、steer/follow-up、dequeue、unsupported model、compaction success/failure/cancel、reload/session switch 和 GIF passthrough。
- [ ] session 结果确认提交文本只含 Image Reference，plugin-owned 图片以 flat Image Attachment 持久化，且不含对应临时路径。
- [ ] 当前可用平台与 provider 的实际覆盖和未覆盖项记录在包文档中，不把未执行的平台测试声明为已验证。
- [ ] 验证过程不执行 `pi install`，除非用户另行明确要求。
