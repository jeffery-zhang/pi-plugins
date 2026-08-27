# 02 - 稳定的多图 Image Draft

Type: task
Status: ready-for-agent
Blocked by: 01

Spec: [TUI Image Input with Stable References](../spec.md)

## Outcome

在单图链路上建立完整的 Image Draft 身份规则：多张 Pending Image 获得稳定且单调递增的 Image Reference，编辑操作不改变身份，历史恢复不依赖持久化 provenance。

## Acceptance Criteria

- [ ] 连续粘贴受支持图片会生成 session 内单调递增且不复用的 Image Reference。
- [ ] 分配新编号时跳过 active draft 中未知的手写 `[Image #N]`，不把该 token 捕获成插件状态。
- [ ] 已有 live mapping 的同号 token 无论复制多少次都指向同一 Staged Image，并只产生一个 Image Attachment。
- [ ] 移动 token 不改变 Image Reference；删除最后一个 occurrence 后 mapping 进入 dormant 状态，undo 或重新出现时恢复原身份。
- [ ] 提交只处理当时仍有 token 的 Pending Image；提交或明确丢弃草稿时释放 dormant mapping。
- [ ] 多张插件 Image Attachment 始终按 Image Reference 数字升序追加，不按 token 当前文本位置排序。
- [ ] 成功交付后释放已消费 mapping，但 session counter 继续递增。
- [ ] 新 session 从 `Image #1` 开始。
- [ ] resume、fork 和 reload 从 active branch 中带图片附件的历史 user message 恢复最高可见编号；文本消息中的手写引用不参与恢复。
- [ ] 不写 counter、Image Reference provenance 或 Pending Image 路径到 custom session entry。
- [ ] 历史消息中手写 token 与其他来源图片混合时保持 spec 规定的 best-effort 限制，不添加猜测性持久化机制。
- [ ] 插件不向模型注入 Image Reference 到 attachment position 的显式映射。
- [ ] 自动场景覆盖多图、未知编号跳过、复制、移动、删除、undo、dormant 清理、数字排序、新 session、resume 和 fork。
