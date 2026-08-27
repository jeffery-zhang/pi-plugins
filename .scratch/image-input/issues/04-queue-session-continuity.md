# 04 — 队列与 session 生命周期连续性

**What to build:** 让 Image Draft 和 Image Reference 在 TUI 的正常流式队列、重试、session 切换及扩展替换过程中保持一致。已经交付的图片释放本地 Pending Image 状态，未交付的草稿则必须可恢复，不能留下失效占位符。

**Blocked by:** 03 — 失败关闭的图片提交.

**Status:** ready-for-agent

- [ ] 正常 streaming Enter 的 steer 输入会经过图片处理并携带 Image Attachment。
- [ ] 正常 streaming Alt+Enter 的 follow-up 输入会经过相同图片处理。
- [ ] dequeue、abort 和 retry 恢复文本时，相关 Pending Image 仍可重新组成有效 Image Draft。
- [ ] 本地 Pending Image 状态只在对应用户消息被 Pi 接受后释放，preflight 失败不会提前丢失状态。
- [ ] 成功提交后清理已消费的临时映射，但 session 编号继续递增。
- [ ] 新 session 从 `Image #1` 开始。
- [ ] resume 和 fork 根据目标 session 的历史 Image Reference 恢复后续编号，避免重复。
- [ ] reload、new、resume、fork、tree switch 或扩展替换前，未提交 Image Reference 会还原为原始临时路径。
- [ ] 生命周期清理和恢复操作是幂等的，不会重复附件或损坏编辑器文本。
- [ ] 已提交的 Image Reference 在图片离开 active context 后仍可显示，但插件不会自动重新附加历史图片。
- [ ] 自动场景覆盖流式排队、dequeue/retry、新 session、resume/fork 和 reload/session replacement。
