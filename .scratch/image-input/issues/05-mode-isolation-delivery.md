# 05 - 模式隔离与真实交付验证

Type: task
Status: resolved
Blocked by: 04

Spec: [TUI Clipboard Image Attachment Bridge](../spec.md)

## Outcome

完成非 TUI 输入隔离、文档和真实 TUI 验证，证明 Attachment Bridge 在正常扩展环境中与 `pi-fff` 共存，并把图片直接持久化为同一条 user message 的 ImageContent。

## Acceptance Criteria

- [x] RPC path text、RPC image payload、RPC steer/follow-up 和 extension-source input 保持不变。
- [x] CLI `@file`、CLI 已有图片、JSON 和 print 模式保持不变。
- [x] GIF、任意普通路径、非 Pi clipboard 路径和手写 `[Image]` 保持不变。
- [x] 插件不安装 custom editor；正常启用 `pi-fff` 时扩展可共同加载。
- [x] 插件不删除 Pi-owned temporary clipboard files，也不持久化 path/provenance/counter。
- [x] package README 和根 README 说明最低 Pi 版本、支持格式、editor 可见路径、`[Image]` marker、idle-only、失败关闭和模型工具行为边界。
- [x] package `check`/`test`、frozen lockfile 和 `git diff --check` 全部通过。
- [x] 真实 TUI smoke 在正常已安装扩展环境中运行，不使用 `--no-extensions`。
- [x] smoke 覆盖单图和多图 PNG/JPEG/WebP、GIF passthrough、unsupported model 和 busy-state 阻止。
- [x] session 结果确认提交 text 含 `[Image]` 且无对应 `pi-clipboard-*` path，同一 user message 含预期数量的 flat ImageContent。
- [x] 模型可直接描述图片作为辅助证据，session message 结构作为交付权威。
- [x] 当前可用平台/provider 的实测覆盖和未覆盖项记录在包文档中，不虚报未执行验证。
- [x] 验证过程未执行 `pi install`。

## Answer

已完成非 TUI 模式隔离、边界加固、文档同步和真实 Windows TUI 验证。RPC、extension source、JSON、print、CLI-style payload 与既有 images 保持原契约；URI-like、ADS 和 Unicode 邻接 path token 不会被误转换。正常扩展环境（含 `pi-fff`）与隔离加载均通过，人工 smoke 覆盖 image-capable/text-only 模型、单图/多图、GIF、busy-state 和 session 结构。

自动回归额外使用 2501x1 PNG 证明插件确实经过 Pi 默认 `resizeImage()`：交付附件变为 2000x1 且字节不同于源文件。最终验证通过 `check`、21/21 tests、frozen lockfile、两种 `pi -e` 加载和 `git diff --check`；未执行 `pi install`。复审后另补了 stable semver prerelease guard，以及 terminal feedback 失败仍保持 fail-closed 的回归。
