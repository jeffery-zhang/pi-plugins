# 05 — 跨模式隔离与交付验证

**What to build:** 完成 Image Input 的兼容性边界、文档和端到端验证，使插件能够安全交给 Agent 实现或维护，而不会改变 RPC、CLI 或其他扩展输入契约。

**Blocked by:** 04 — 队列与 session 生命周期连续性.

**Status:** ready-for-agent

- [ ] RPC 的路径文本和图片 payload 保持原样，包括 RPC steer 与 follow-up。
- [ ] extension source 输入保持原样。
- [ ] CLI `@file` 图片继续由 Pi 原生入口处理，插件不重复规范化。
- [ ] 任意普通文件路径、非 Pi 剪贴板路径和未知 Image Reference 保持原样。
- [ ] 所有实现只依赖 Node.js 标准库和 Pi 的公开导出，不增加第三方运行时依赖。
- [ ] 所需 API 均针对仓库声明的 Pi 0.84.2 基线验证；本机 0.84.3 兼容性同时记录，但不隐式升级基线。
- [ ] 插件声明的检查和测试命令全部通过。
- [ ] 真实 TUI 冒烟覆盖单图、多图、streaming steer/follow-up、非视觉模型、compaction 和未提交草稿 reload/session switch。
- [ ] 会话结果确认只保留 Image Reference 和规范化 Image Attachment，不包含临时路径。
- [ ] 包文档说明行为、限制、失败语义和验证方式，仓库 README 同步登记已实现插件。
- [ ] 验证过程不执行安装命令，除非用户另行明确要求。
