# Pi 图片输入扩展研究

> 面向本仓库后续插件实现。兼容基线：`@earendil-works/pi-coding-agent@0.84.2`，对应 Pi 提交 [`914cf14`](https://github.com/earendil-works/pi/tree/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent)。本报告只使用项目源码、GitHub API/仓库和模型厂商官方文档；stars/更新时间为查询时快照，不能等同于质量保证。

## 结论

推荐先做一个小型、跨 provider 的“图片预算”插件：复用 `pi-image-tools` 的暂存图片 + `input` 事件注入模式，但在生成 base64 前完成等比缩放、可选裁剪和 JPEG/WebP 有损编码；默认最长边 1,568 px（保守兼顾 Claude），另提供 384/512 px 的低细节档和原图档。首版不要改 provider 请求，也不要做终端内联预览。

图片文件压缩主要降低上传字节和请求大小，不必然降低视觉 token；主流模型通常按像素尺寸、分块或 `detail`/`media_resolution` 计费。因此优先级应是：裁剪无关区域 > 降低像素尺寸 > provider 的低细节参数 > 改编码质量。历史图片还会在后续轮次重复进入上下文，故限制每条消息张数、在 `context` 事件中淘汰旧图通常比 WebP/JPEG 转码更省 token。

## 现有实现与活跃度

| 候选 | 可观察指标 | 关键能力 | 适用性 |
| --- | --- | --- | --- |
| [`MasuRii/pi-image-tools`](https://github.com/MasuRii/pi-image-tools) | 查询时 41 stars、7 forks、未归档；仓库有近期 push，发布到 `v1.0.4` | Windows/Linux/macOS 剪贴板、多图暂存、recent picker、`input` 事件注入、终端预览；默认仅拒绝超过 20 MB 的图 | 最成熟、最受欢迎的直接参考。其 [`src/index.ts`](https://github.com/MasuRii/pi-image-tools/blob/main/src/index.ts) 明确构造 `{type:"image", data, mimeType}`，在 `input` 返回 `transform` 合并 `event.images`。但未以视觉 token 为目标做缩放/压缩。 |
| [`monotykamary/pi-vision-handoff`](https://github.com/monotykamary/pi-vision-handoff) | 查询时 17 stars、8 forks、未归档且近期 push | 在 `context` 事件把图片交给视觉模型，再用文字描述替换，供纯文本主模型使用 | 对主模型完全移除图片 token，但增加一次模型调用、描述损失和隐私面；适合作为可选“handoff”模式，不宜作为首版默认。 |
| [`RielJ/pi-image-preview`](https://github.com/RielJ/pi-image-preview) | 查询时 4 stars、5 forks、未归档且近期 push | Kitty/tmux 预览；预览转 PNG；提交前缩小超过 provider 字节限制的图 | 缩放代码值得参考，但入口仍从弃用的 `@mariozechner/pi-coding-agent` 导入，且 README 建议 latest，不能直接视为 0.84.2 兼容实现。[入口源码](https://github.com/RielJ/pi-image-preview/blob/main/index.ts) |
| [`affsantos/pi-screenshots`](https://github.com/affsantos/pi-screenshots) | 查询时 0 stars、0 forks、未归档 | 截图目录选择、暂存、多图附加、macOS 捕获 | 小而贴近“选截图”工作流，但维护/采用证据弱，且没有 token 优化。 |
| [`like-attract/pi-multivision`](https://github.com/like-attract/pi-multivision) | 查询时 0 stars、0 forks、未归档且近期 push | 注册视觉工具，多后端 fallback，给纯文本模型返回描述 | 与 handoff 同类但显式工具调用更可审计；采用度低、引入 provider 配置和重试复杂度，不适合最小首版。 |

补充：Pi 自身已是最重要的紧密相关实现。0.84.2 的内置 `read` 会识别 jpg/png/gif/webp/bmp，并把图作为原生图片 content 返回，而非把 base64 塞进文本；源码见 [`read.ts`](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/tools/read.ts)。

## 0.84.2 接入核对

固定提交的 [`types.ts`](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/core/extensions/types.ts) 给出以下可用边界：

1. **输入拦截**：`pi.on("input", handler)` 收到 `event.text`、`event.images?: ImageContent[]` 和 source；返回 `{ action: "transform", text, images }` 可替换/追加附件。这是“先暂存，用户按 Enter 时附加”的最佳入口。
2. **消息注入**：`pi.sendUserMessage(content)` 接受字符串或 `(TextContent | ImageContent)[]`。0.84.2 的 `ImageContent` 实际形状由内置 `read` 证实为 `{ type: "image", data: <base64>, mimeType: "image/..." }`。流式期间需指定 `deliverAs: "steer" | "followUp"`；它会额外触发一轮，因此不应用于改写当前 Enter 提交。
3. **模型工具**：`registerTool().execute()` 返回 `AgentToolResult`，其 `content` 可含 text/image；内置 `read` 就是规范示例。工具必须尊重 `AbortSignal`，错误直接 `throw`。这适合“截图/裁剪后让模型看结果”，不适合透明优化用户当前附件。
4. **命令**：`registerCommand` 适合 `/image-add`、`/image-clear`、`/image-mode low|balanced|original` 等显式动作；命令只负责暂存/配置，实际附件在下一次 `input` transform 中提交。
5. **历史治理**：`pi.on("context")` 可在每次 LLM 调用前替换 `messages`，适合只保留最近 N 张图或把旧图替换为文字占位。此操作影响模型可见历史，必须默认保守并可关闭。
6. **模型能力**：检查 `ctx.model?.input.includes("image")`；0.84.2 内置 `read` 对非视觉模型会明确提示图片将被省略。

不要把图片 base64 放进文本结果。Pi 文本工具结果的 50 KB/2,000 行截断与图片 attachment 是两条路径；正确返回 `ImageContent` 才不会被文本截断。

## Pi 已有图片处理

0.84.2 的 [`image-resize-core.ts`](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/utils/image-resize-core.ts) 提供直接可复用的算法证据：

- 默认最大 2,000×2,000；base64 编码后小于 4.5 MB，为 Anthropic 5 MB 单图限制留余量；默认 JPEG quality 80。
- 先等比缩放，再同时尝试 PNG 和 JPEG，选择满足预算者；之后依次尝试 JPEG quality 80/85/70/55/40，仍过大则每轮把宽高缩至 75%。
- [`image-process.ts`](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/src/utils/image-process.ts) 会保留 PNG/JPEG/GIF/WebP，其他可解码格式转 PNG。

风险是这些实现位于 `src/utils`，不能仅凭内部源码假定它们是 0.84.2 的稳定公共 export。实现前应通过包的 `exports`/类型声明确认；若未公开，应使用一个明确的第三方图像依赖或在上游请求公共 API，不能深导入内部文件。

## Token 与模型限制

### OpenAI

OpenAI 官方 [Images and vision](https://platform.openai.com/docs/guides/images-vision) 提供 `detail: "low" | "high" | "auto"`，并按模型说明用基础图和 512 px tiles 估算视觉 token。`low` 适合只需整体语义的截图，可显著减少图像 token；小字/OCR/精确坐标需要 `high` 或裁剪后的局部图。

Pi 的通用 `ImageContent` 没有 `detail` 字段。可用 `before_provider_request` 改 OpenAI payload，但它是 provider 私有结构、会随 Pi/provider adapter 演进，首版不推荐。更稳妥的是像素档位 + 裁剪，后续再做受严格 provider/model guard 和 payload 形状测试保护的实验开关。

### Anthropic

Anthropic 官方 [Vision](https://docs.anthropic.com/en/docs/build-with-claude/vision) 建议在发送前缩小过大的图片；其文档给出约 `tokens = width × height / 750` 的估算，并说明超过约 1,568 px 长边或约 1.15MP 的图片会被缩放、增加首 token 延迟而不提升模型可见分辨率。支持 JPEG/PNG/GIF/WebP，并有单图/请求数量和字节限制。由此可见，把 4K 截图缩至任务所需尺寸会直接降低 token；仅把同尺寸 PNG 转 WebP/JPEG主要降低字节。

### Gemini

Google 官方 [Image understanding](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding) 和 [Token counting](https://ai.google.dev/gemini-api/docs/generate-content/tokens) 说明：两边均不超过 384 px 的图计 258 tokens；更大的图会被裁剪/缩放为 768×768 tiles，每 tile 258 tokens。Gemini 3 的 `media_resolution` 控制每张图/帧的最大 token 分配，分辨率越高越利于小字但增加 token 与延迟。inline data 的整个请求上限为 20 MB，重复使用大图时 File API 更高效。

和 OpenAI `detail` 一样，Pi `ImageContent` 不表达 `media_resolution`。首版应按像素预算工作，不能承诺跨 provider 的精确 token 数。

## 方案对比

| 方案 | Token 效果 | 实现/兼容风险 | 建议 |
| --- | --- | --- | --- |
| A. 暂存 + 提交前缩放/裁剪/编码 | 高；跨 provider，像素减少通常直接减少 tiles/token | 需要可靠解码、EXIF 方向、动画/透明度处理 | **首选最小实现** |
| B. `context` 中只保留最近 N 张图 | 很高；避免每轮重发旧图 | 会丢失历史视觉证据；必须保留占位说明和关闭开关 | 第二阶段，默认 N=4 或仅在预算超限时启用 |
| C. OpenAI `detail=low` / Gemini `media_resolution` | 对支持模型很高 | `before_provider_request` 依赖私有 payload，跨 adapter 脆弱 | 实验性、按 provider/model 白名单启用 |
| D. 视觉 handoff，图转文字 | 主模型图片 token 归零 | 多一次调用、语义损失、密钥/隐私/延迟复杂 | 纯文本模型的可选模式 |
| E. 仅 PNG→WebP/JPEG | 对请求字节有效；对按像素分块计 token 通常有限 | 有损压缩可能破坏小字；WebP provider 支持差异 | 作为 A 的编码步骤，不单独宣传省 token |

## 推荐最小实现路径

1. 新包按仓库约定放 `packages/<name>/src/index.ts`，只依赖 `@earendil-works/*` 0.84.2 API；不要复制终端图片预览代码。
2. 提供 `/image-add <path>`、`/image-clear`、`/image-mode low|balanced|original`，并在 TUI 下可选 recent picker；先覆盖本地文件，剪贴板后置，避免首版承担三平台 clipboard backend。
3. 暂存原始路径和配置，不长期保存 base64；用户提交时读取、校验 MIME/尺寸，处理后构造 `ImageContent`，由 `input` transform 合并已有 `event.images`。限制单图和单消息总字节、数量，并尊重取消。
4. 默认 `balanced`：最长边 1,568 px、约 1.15MP 上限、JPEG quality 80；`low`：最长边 512 px（Gemini 极省档可另给 384 px）；含 alpha/线稿优先 PNG，其余比较 PNG/JPEG/WebP 后选满足质量与预算者。WebP 是否作为出站格式应由目标模型支持矩阵决定。
5. 裁剪作为显式参数/命令，不做自动主体检测。小字截图优先“裁剪局部 + balanced/high”，不要把整张 4K 图粗暴压成 512 px。
6. 第二阶段增加可关闭的历史预算：在 `context` 中保留最近 N 张/总像素预算内的图片，旧图换成 `[older image omitted by image budget]`。同时记录处理前后尺寸、编码和估算 token，绝不记录图片数据。
7. 最小验证包括：PNG/JPEG/WebP、EXIF 旋转、透明图、超大图、非视觉模型、取消、无 UI、已有附件合并、连续消息不串图、reload 清空状态，以及 `pi -e ./packages/<name>` 实际提交到至少 Claude/Gemini/OpenAI 各一个视觉模型。

## 风险与审查发现

- **高**：只改 JPEG/WebP quality 可能几乎不降低视觉 token；产品指标必须以 provider usage/count-tokens 验证，不能以文件 KB 代替。
- **高**：`context` 删除旧图是有损行为，会影响后续比较和定位；默认应关闭或只在明确预算超限时启用。
- **中**：0.84.2 内置 resize 是内部模块；未经 `exports` 核对而深导入会造成发布/升级失败。
- **中**：OpenAI `detail`、Gemini `media_resolution` 不在通用 `ImageContent` 中；payload hook 需要 adapter 级回归测试。
- **中**：当前 `pi-image-tools` 的 20 MB 门槛只防请求过大，不降低 token；直接照搬不满足本项目核心目标。
- **中**：仓库 `pnpm-lock.yaml` 当前解析到 0.84.3，而规范文档指定 0.84.2。实现验证必须显式固定/核对实际运行版本，避免误判兼容性。
- **低**：GIF 动画、alpha、OCR 小字和 EXIF 会使统一 JPEG 策略失真；需要按内容类型保留 PNG或首帧策略并给用户反馈。

## 保留与排除的来源

**保留**：Pi 0.84.2 固定提交的扩展类型、`read`、图片处理源码；上述五个扩展的 GitHub 仓库与 GitHub API 元数据；OpenAI、Anthropic、Google 官方视觉文档。它们分别证明 API 形状、现成实现、维护指标和模型计费机制。

**排除**：博客、聚合列表、论坛推测；`pi-image-subagent` 等采用度低且明确“不缩放”的重复实现；图片生成插件，因为目标是输入而非生成；GitHub issue 只用于识别风险，不用作厂商限制的一手依据。

## 尚待实现阶段核验

- 0.84.2 包根是否正式导出 `resizeImage`/转换函数；若没有，选择的图像依赖及其跨平台二进制体积。
- 目标模型清单的实时格式、单图/总请求限制，以及 OpenAI 不同模型的 `detail` token 公式；这些会变化，应做 capability/config 表而非硬编码为永恒事实。
- 用真实 UI/OCR/照片样本建立 `low`/`balanced` 的质量与 usage 基准，尤其比较“整图缩放”和“局部裁剪”。
