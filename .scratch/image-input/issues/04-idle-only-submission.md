# 04 - Idle-only 图片提交守卫

Type: task
Status: resolved
Blocked by: 03

Spec: [TUI Clipboard Image Attachment Bridge](../spec.md)

## Outcome

只在 Pi idle 时允许 Clipboard Image Path 提交。Streaming、steer/follow-up 和 active compaction 中的图片草稿保持在 editor，不进入缺少可逆图片状态的 host queue。

## Acceptance Criteria

- [x] idle 普通提交继续经过 ImageContent 转换。
- [x] session streaming 时，含 eligible path 的普通 Enter 或 follow-up 提交被阻止并保留原始草稿。
- [x] active compaction 时，含 eligible path 的提交在进入 special text queue 前被阻止。
- [x] busy-state feedback 明确说明图片只能在 Pi idle 后重试。
- [x] busy guard 只消费图片-bearing submit，不冻结普通编辑，也不改变 text-only queue 行为。
- [x] compaction success、failure 和 cancellation 后 guard 状态可靠解除，使用 Pi 0.84.3 lifecycle events。
- [x] 插件不创建 prepared ledger，不关联 queue/message ID，不实现 dequeue 图片恢复。
- [x] 若 streaming input 已到达 `input` hook，handler 返回 handled 并恢复原始草稿，而不是生成 queued ImageContent。
- [x] terminal-input guard、listener 和 compaction state 在 session shutdown/replacement 时幂等释放。
- [x] 自动场景覆盖 idle、streaming 两种行为、active compaction、compaction success/failure/cancel 和 text-only passthrough。

## Answer

图片提交现严格限制在 Pi idle 状态。Streaming 的 steer/follow-up input 在 `input` hook 中恢复原稿并返回 handled；active compaction 则在 editor 提交前通过 raw terminal listener 拦截当前配置的 submit/follow-up key。该 guard 仅在 editor 含 eligible path 时消费按键，text-only queue 和普通编辑不受影响。`session_compact`、`session_compact_failed`（含 abort）解除 busy 状态，`session_shutdown` 幂等注销 listener。

验证通过：`pnpm --filter @pi-plugins/image-input check`、`pnpm --filter @pi-plugins/image-input test`（18/18）和 `git diff --check`。
