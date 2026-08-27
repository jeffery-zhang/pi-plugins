# 04 - Streaming Queue 与 Prepared Ledger

Type: task
Status: ready-for-agent
Blocked by: 03

Spec: [TUI Image Input with Stable References](../spec.md)

## Outcome

支持正常 streaming Enter/Alt+Enter 图片提交，并用插件拥有的 prepared ledger 弥补 Pi dequeue 只恢复文本、queue/message 无稳定 ID 的宿主限制。排队、dequeue、abort 和 retry 不丢图、不重复附件。

## Acceptance Criteria

- [ ] streaming Enter 的 steer 和 Alt+Enter 的 follow-up 都经过同一图片 preflight，并把 Image Attachment 放入 Pi 正常 queue。
- [ ] input transform 成功后，Staged Image mapping 从 active draft 转入 prepared ledger，直到对应 user `message_start` 才释放。
- [ ] queued Image Reference 由该提交独占；新 active draft 中手写相同 token 不借用 queued mapping。
- [ ] delivery confirmation 使用 prepared FIFO、Image Reference set 和 attachment count，不要求最终文本与原始文本完全相同。
- [ ] skill 和 prompt-template expansion 改变最终文本时仍能确认正确 prepared entry。
- [ ] dequeue 或 abort 通过 host `setText()` 恢复文本时，插件从 prepared ledger 重新组成有效 Image Draft，而不依赖 host 返回 queued images。
- [ ] 明确丢弃 dequeued draft 会释放对应 ledger；重新提交不会复制 Image Attachment。
- [ ] user message 已 committed 后的 retry 使用 Pi 已保存的 Image Attachment，不重新读取或规范化临时文件。
- [ ] 已带附件进入 Pi normal queue 的 prepared message 不阻止 compaction；editor 中新的 active Image Draft 仍遵守 ticket 03 的 compaction 守卫。
- [ ] 相同文本、多个 queued submission、两种 streaming behavior 和反复 dequeue 不会串联错误 mapping。
- [ ] 自动场景覆盖 steer、follow-up、exclusive ownership、skill/template expansion、message commit、dequeue、abort、retry 和 queued-message compaction。
- [ ] 真实 TUI 冒烟验证 steer/follow-up、至少一次 dequeue 或 abort 恢复，以及最终 session message 的图片数量和顺序。
