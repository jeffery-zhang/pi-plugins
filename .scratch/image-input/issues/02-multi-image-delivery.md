# 02 - 多图顺序与 Image Marker 语义

Type: task
Status: resolved
Blocked by: 01

Spec: [TUI Clipboard Image Attachment Bridge](../spec.md)

## Outcome

扩展单图桥接，使一个 idle Image Draft 中的全部 eligible clipboard paths 以全有或全无方式转换；提交文本保留 occurrence 位置，附件顺序确定且无需编号或 provenance。

## Acceptance Criteria

- [x] 草稿中所有 eligible PNG/JPEG/WebP paths 都被收集并转换，不只处理第一张。
- [x] 每个 path occurrence 在原位置替换为一个 `[Image]`。
- [x] 插件 Image Attachments 按 path occurrence 顺序追加。
- [x] 同一路径出现两次时产生两个 markers 和两张附件，不做附件去重。
- [x] 实现在单次提交内复用同一路径的规范化结果，不改变 occurrence 数量或顺序。
- [x] 用户手写的 `[Image]` 不创建附件，也不与 plugin markers 建立持久身份。
- [x] 现有 `event.images` 保持原顺序，全部插件图片位于其后。
- [x] 混合 supported paths、GIF 和普通路径时，只转换 eligible paths；其他文本保持原样。
- [x] 提交后不保留 counter、pending mapping、provenance 或历史重附状态。
- [x] 自动场景覆盖混合格式、多图顺序、重复路径、手写 marker 和现有图片组合。

## Answer

扩展现已转换一条 idle Image Draft 中的全部 eligible path occurrences。文本按原 occurrence 位置写入 `[Image]`，插件附件按相同顺序追加在已有 `event.images` 后；重复路径在单次提交内复用规范化结果，但仍产生独立 marker 和附件 occurrence。GIF、普通路径和手写 marker 保持原文本，不维护 counter、provenance 或历史映射。

验证通过：`pnpm --filter @jingoz/pi-image-input check`、`pnpm --filter @jingoz/pi-image-input test`（12/12）和 `git diff --check`。
