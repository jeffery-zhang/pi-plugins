# 03 — 失败关闭的图片提交

**What to build:** 确保 Image Draft 只有在所有 Pending Image 都能被完整交付时才会提交。任何图片处理失败、模型能力不足或 compaction 状态都必须阻止整条消息，保留用户草稿并给出明确反馈。

**Blocked by:** 02 — 稳定的多图 Image Draft.

**Status:** ready-for-agent

- [ ] Staged Image 不存在、不可读或内容与支持的图片 MIME 不符时阻止提交。
- [ ] 不支持的图片格式或图片规范化失败时阻止提交。
- [ ] 当前模型未声明图片输入能力时阻止含 Pending Image 的提交。
- [ ] Pi 正在执行 compaction 时阻止含 Pending Image 的提交，不让引用进入特殊 compaction 队列。
- [ ] 多图提交采用全有或全无语义；任意一张失败时不提交任何图片或文本。
- [ ] 所有阻止路径都保留完整 Image Draft 和 Pending Image 状态，以便用户修复或重试。
- [ ] 所有阻止路径都在 TUI 给出简洁、可定位到具体原因的错误反馈。
- [ ] 文本消息和不含 Pending Image 的输入不受这些图片守卫影响。
- [ ] 失败场景测试只断言提交结果、草稿保留和用户反馈，不依赖内部异常或状态结构。
