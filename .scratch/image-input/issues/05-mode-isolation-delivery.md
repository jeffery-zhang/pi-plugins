# 05 - 模式隔离与真实交付验证

Type: task
Status: ready-for-agent
Blocked by: 04

Spec: [TUI Clipboard Image Attachment Bridge](../spec.md)

## Outcome

完成非 TUI 输入隔离、文档和真实 TUI 验证，证明 Attachment Bridge 在正常扩展环境中与 `pi-fff` 共存，并把图片直接持久化为同一条 user message 的 ImageContent。

## Acceptance Criteria

- [ ] RPC path text、RPC image payload、RPC steer/follow-up 和 extension-source input 保持不变。
- [ ] CLI `@file`、CLI 已有图片、JSON 和 print 模式保持不变。
- [ ] GIF、任意普通路径、非 Pi clipboard 路径和手写 `[Image]` 保持不变。
- [ ] 插件不安装 custom editor；正常启用 `pi-fff` 时 FFF autocomplete 和 Image Input 均可用。
- [ ] 插件不删除 Pi-owned temporary clipboard files，也不持久化 path/provenance/counter。
- [ ] package README 和根 README 说明最低 Pi 版本、支持格式、editor 可见路径、`[Image]` marker、idle-only、失败关闭和模型工具行为边界。
- [ ] package `check`/`test`、frozen lockfile 和 `git diff --check` 全部通过。
- [ ] 真实 TUI smoke 在正常已安装扩展环境中运行，不使用 `--no-extensions`。
- [ ] smoke 覆盖单图和多图 PNG/JPEG/WebP、GIF passthrough、unsupported model 和 busy-state 阻止。
- [ ] session 结果确认提交 text 含 `[Image]` 且无对应 `pi-clipboard-*` path，同一 user message 含预期数量的 flat ImageContent。
- [ ] 模型能直接描述图片可作为辅助证据，但 session message 结构是交付权威。
- [ ] 当前可用平台/provider 的实测覆盖和未覆盖项记录在包文档中，不虚报未执行验证。
- [ ] 验证过程不执行 `pi install`，除非用户另行明确要求。
