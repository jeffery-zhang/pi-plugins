# 04 - Idle-only 图片提交守卫

Type: task
Status: ready-for-agent
Blocked by: 03

Spec: [TUI Clipboard Image Attachment Bridge](../spec.md)

## Outcome

只在 Pi idle 时允许 Clipboard Image Path 提交。Streaming、steer/follow-up 和 active compaction 中的图片草稿保持在 editor，不进入缺少可逆图片状态的 host queue。

## Acceptance Criteria

- [ ] idle 普通提交继续经过 ImageContent 转换。
- [ ] session streaming 时，含 eligible path 的普通 Enter 或 follow-up 提交被阻止并保留原始草稿。
- [ ] active compaction 时，含 eligible path 的提交在进入 special text queue 前被阻止。
- [ ] busy-state feedback 明确说明图片只能在 Pi idle 后重试。
- [ ] busy guard 只消费图片-bearing submit，不冻结普通编辑，也不改变 text-only queue 行为。
- [ ] compaction success、failure 和 cancellation 后 guard 状态可靠解除，使用 Pi 0.84.3 lifecycle events。
- [ ] 插件不创建 prepared ledger，不关联 queue/message ID，不实现 dequeue 图片恢复。
- [ ] 若 streaming input 已到达 `input` hook，handler 返回 handled 并恢复原始草稿，而不是生成 queued ImageContent。
- [ ] terminal-input guard、listener 和 compaction state 在 session shutdown/replacement 时幂等释放。
- [ ] 自动场景覆盖 idle、streaming 两种行为、active compaction、compaction success/failure/cancel 和 text-only passthrough。
