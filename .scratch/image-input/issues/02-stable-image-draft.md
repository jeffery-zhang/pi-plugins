# 02 — 稳定的多图 Image Draft

**What to build:** 扩展单图链路，使一个 Image Draft 可以容纳多张 Pending Image，并让每个 Image Reference 在当前 session 中保持稳定身份。用户可以删除、复制和移动引用，而附件身份、数量及最终交付顺序始终可预测。

**Blocked by:** 01 — 单张 Staged Image 端到端交付.

**Status:** ready-for-agent

- [ ] 连续粘贴多张图片会生成 session 内单调递增且不复用的 Image Reference。
- [ ] 成功提交后编号继续递增，不从 1 重新开始。
- [ ] 移动 Image Reference 在草稿中的位置不会改变其编号。
- [ ] 删除某个 Image Reference 的最后一个出现位置会取消对应 Pending Image。
- [ ] 复制同一个 Image Reference 仍只产生一个 Image Attachment。
- [ ] 用户手写的未知 `[Image #N]` 只作为普通文本，不创建或恢复图片。
- [ ] 用户自然语言中的 `Image N` 不参与插件状态控制。
- [ ] 多张 Image Attachment 始终按 Image Reference 数字升序交付，而不是按当前文本位置排序。
- [ ] 插件不向模型添加显式 Image Reference 到附件位置的映射，关联准确性保持尽力而为。
- [ ] 自动场景覆盖多图、删除、复制、移动、未知引用和稳定编号行为。
