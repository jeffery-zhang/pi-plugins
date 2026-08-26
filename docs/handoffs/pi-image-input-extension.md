# Handoff: Integrated Pi Image Input Extension

> P0 requirements are finalized in [`../../.scratch/image-input/spec.md`](../../.scratch/image-input/spec.md). This handoff is retained as research and design background; where it conflicts with the P0 spec, the spec wins. Implementation is intentionally deferred.

## Session Decision

本会话决定将“图片输入”和“图片优化/预算控制”整合为一个 Pi 扩展，不拆成两个独立的 Pi extension。

原因：图片路径或剪贴板内容进入消息、生成 `ImageContent`、处理图片质量之间存在严格顺序。让多个扩展分别注册 `input` transform 会引入处理顺序、重复压缩、队列所有权和状态同步问题。单个扩展由一个 factory、一个待发送队列和一个统一处理流水线负责，边界更清晰。

这份 handoff 取代旧的 `pi-image-paste-extension.md`。旧文档基于 `TommyFork/pi-image-drop` 的调查，不能作为当前实现方向。

## Objective

为 Pi 提供可靠的本地图片输入能力，并在发送给模型前降低视觉 token、请求体和上下文图片数量：

```text
剪贴板/拖放/图片路径
  -> 待发送队列
  -> 统一 input 流程
  -> 读取与校验
  -> resize/crop/encode
  -> ImageContent
  -> 当前用户消息
```

首版面向 `@earendil-works/pi-coding-agent@0.84.2`，不修改 Pi core，不依赖已废弃的 `@mariozechner/*` 包。

## Repository Constraints

- 插件目录：`packages/image-input/`。
- 至少包含 `package.json` 和 `src/index.ts`。
- 使用 `type: "module"`、`private: true` 和显式 `pi.extensions`。
- Pi 自带包从 `@earendil-works/*` 导入，并放在 `peerDependencies`。
- 当前规范基线是 `0.84.2`，但 `pnpm-lock.yaml` 当前解析到 `0.84.3`；实现和冒烟测试前必须核对实际运行版本。
- 暂不安装第三方扩展或运行 `pi install`。

## Reference Research

### Preferred Direct Reference

[MasuRii/pi-image-tools](https://github.com/MasuRii/pi-image-tools)

查询时约 41 stars、7 forks，未归档且有近期更新。它使用“暂存图片 + `input` transform 注入 `ImageContent`”的模式，支持多图和图片选择，是最值得参考的现成实现。但它主要解决输入流程，没有针对视觉 token 做像素预算治理。

### Optional Reference

[monotykamary/pi-vision-handoff](https://github.com/monotykamary/pi-vision-handoff) 可以先让视觉模型生成文字描述，再交给纯文本模型，从主模型上下文中移除图片 token。它会增加一次调用、引入描述损失和隐私风险，作为后续可选模式，不作为首版默认。

[RielJ/pi-image-preview](https://github.com/RielJ/pi-image-preview) 有可参考的缩放逻辑，但仍导入已废弃的 `@mariozechner/pi-coding-agent`，不直接采用。

Pi 内置 `read` 已经能将 jpg/png/gif/webp/bmp 作为原生图片 content 返回，因此本插件主要解决输入体验和图片预算，而不是补充底层图片支持。

完整调研见 [`docs/research/pi-image-input-extension.md`](../research/pi-image-input-extension.md)。

## Proposed Extension Design

### Single Owner

`src/index.ts` 的 factory 统一注册：

- 图片输入命令：`/image-add <path>`、`/image-clear`、`/image-mode low|balanced|original`。
- 图片路径、剪贴板、拖放的识别和待发送队列。
- 一个负责当前提交的 `input` handler。
- 后续可在同一扩展内增加 `context` handler，用于历史图片预算治理。

内部可以把无状态图片处理抽成小模块，但不要建立第二个 Pi extension。初版优先保持实现集中，只有纯逻辑复杂到需要独立测试时才拆 `src/image-transform.ts` 或 `src/path-input.ts`。

### Input Flow

`input` handler 应：

1. 取得并快照本次提交的待发送路径，保留已有 `event.images`。
2. 使用 Node 路径 API 处理 Windows、POSIX、`file://`、空格、引号和 Unicode 路径。
3. 校验普通文件、大小、magic bytes 和可解码性。
4. 读取图片并按当前策略处理。
5. 构造标准 `{ type: "image", data, mimeType }`。
6. 保留文本、图片顺序和已有附件，返回 `transform` 结果。
7. 成功后清理本次已提交的队列；取消或失败时保留原始文本，不静默丢图。

不要把 Base64 放进文本，也不要覆盖用户原图。Base64 不应写入日志。

### Optimization Policy

默认提供三档：

- `low`：最长边 384/512 px，适合整体语义。
- `balanced`：最长边约 1,568 px，约 1.15MP，JPEG quality 80。
- `original`：不主动缩放，仍执行格式和大小校验。

优化优先级：

```text
裁剪无关区域 > 降低像素尺寸 > provider 低细节参数 > JPEG/WebP 编码
```

JPEG/WebP 主要降低请求字节，不保证降低视觉 token。裁剪先作为显式参数，不做自动主体检测；包含 alpha 或线稿的图片不要强制转 JPEG。

首版不修改 OpenAI `detail` 或 Gemini `media_resolution` 等 provider 私有 payload。后续如增加这些能力，必须按 provider/model 白名单加开关和回归测试。

### History Budget

第二阶段在同一个扩展的 `context` handler 中增加可关闭的历史图片预算，例如只保留最近 N 张或总像素预算内的图片，旧图片替换为文字占位说明。

需要避免同一图片在 `input` 和 `context` 阶段被重复有损压缩。实现时应明确只有一个阶段负责编码，另一个阶段最多做历史淘汰；如果处理所有上下文图片，则用稳定的 hash + 策略缓存避免重复工作。

## Tests and Acceptance

纯逻辑测试至少覆盖：

- Windows、POSIX、`file://`、WSL 路径，以及空格/引号/Unicode 文件名。
- PNG、JPEG、GIF、WebP、BMP、EXIF 方向、透明图和超大图。
- 多图顺序、已有 `event.images` 合并、重复提交和失败恢复。
- 取消、不可读文件、非图片文件、非视觉模型和无 UI 模式。

Pi 冒烟测试：

```bash
pi -e ./packages/image-input
```

实际触发图片命令或路径输入，并验证模型收到的是当前用户消息中的 `ImageContent`，而不是图片路径文本或额外的 `read` 调用。还要验证 `/reload`、`/new` 和 session replacement 后待发送状态不会泄漏。

## Primary References

- [Pi plugin development research](../research/pi-plugin-development.md)
- [Pi image input research](../research/pi-image-input-extension.md)
- [MasuRii/pi-image-tools](https://github.com/MasuRii/pi-image-tools)
- [Pi extension API at the 0.84.2 baseline](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/extensions.md)
- [Pi extension types at the 0.84.2 baseline](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/extensions/types.ts)
- [OpenAI Images and vision](https://platform.openai.com/docs/guides/images-vision)
- [Anthropic Vision](https://docs.anthropic.com/en/docs/build-with-claude/vision)
- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)

## Next Step

从 `packages/image-input/` 开始实现单扩展最小闭环：先做跨平台路径解析、图片校验和 `input` 到 `ImageContent` 的转换，再加入 balanced/low/original 策略和实际 Pi 冒烟测试。实现前先确认当前锁定的 Pi 版本以及图片处理函数是否为公开稳定 export。
