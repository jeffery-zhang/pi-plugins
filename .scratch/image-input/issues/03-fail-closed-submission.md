# 03 - 原子失败关闭与 Compaction 守卫

Type: task
Status: ready-for-agent
Blocked by: 02

Spec: [TUI Image Input with Stable References](../spec.md)

## Outcome

使 Image Draft 只有在全部 Pending Image 都能交付时才提交。所有图片 preflight、模型能力和 active compaction 失败均原子阻止消息，恢复完整草稿，并且不会因 `input` handler 抛错而 fail open。

## Acceptance Criteria

- [ ] 图片 preflight 开始时 editor 暂时阻止新输入；成功后正常解锁，失败时先精确恢复原 Image Draft 再解锁。
- [ ] 当前模型未声明 image input 时，含 Pending Image 的提交被阻止并保留草稿。
- [ ] Staged Image 不存在、不可读、内容签名不是 PNG/JPEG/WebP、内容损坏或 `resizeImage()` 返回 `null` 时阻止提交。
- [ ] 多图采用全有或全无语义；任意图片失败时不提交文本、插件图片或部分结果。
- [ ] 每个失败路径在 TUI 给出简洁且包含相关 Image Reference 或全局原因的错误反馈。
- [ ] `input` handler 捕获所有预期和意外图片处理错误，恢复草稿并返回 `{ action: "handled" }`；不依赖抛出异常停止 provider 请求。
- [ ] 非图片输入和不含已知 Pending Image 的 interactive input 不进入这些守卫。
- [ ] `session_before_compact` 发现尚未处理的 active Image Draft 时取消 compaction。
- [ ] compaction 已在进行时，新的图片提交被阻止，直到 `session_compact` 或 `session_compact_failed` 明确结束状态。
- [ ] compaction 成功、扩展取消、provider 失败和用户中止后，插件状态都能回到可提交状态；不实现 0.84.2 `isIdle()` workaround。
- [ ] Image Draft 不进入 Pi 的 special compaction text queue。
- [ ] 自动测试包含一个明确的 fail-open 回归：底层处理抛错时 provider 不接收原始引用文本。
- [ ] 自动场景覆盖所有 preflight 失败、多图原子性、精确草稿恢复、editor lock 和 compaction success/failure/cancel。
