# 02 - 多图顺序与 Image Marker 语义

Type: task
Status: ready-for-agent
Blocked by: 01

Spec: [TUI Clipboard Image Attachment Bridge](../spec.md)

## Outcome

扩展单图桥接，使一个 idle Image Draft 中的全部 eligible clipboard paths 以全有或全无方式转换；提交文本保留 occurrence 位置，附件顺序确定且无需编号或 provenance。

## Acceptance Criteria

- [ ] 草稿中所有 eligible PNG/JPEG/WebP paths 都被收集并转换，不只处理第一张。
- [ ] 每个 path occurrence 在原位置替换为一个 `[Image]`。
- [ ] 插件 Image Attachments 按 path occurrence 顺序追加。
- [ ] 同一路径出现两次时产生两个 markers 和两张附件，不做附件去重。
- [ ] 实现可以在单次提交内复用同一路径的规范化结果，但不得改变 occurrence 数量或顺序。
- [ ] 用户手写的 `[Image]` 不创建附件，也不与 plugin markers 建立持久身份。
- [ ] 现有 `event.images` 保持原顺序，全部插件图片位于其后。
- [ ] 混合 supported paths、GIF 和普通路径时，只转换 eligible paths；其他文本保持原样。
- [ ] 提交后不保留 counter、pending mapping、provenance 或历史重附状态。
- [ ] 自动场景覆盖混合格式、多图顺序、重复路径、手写 marker 和现有图片组合。
