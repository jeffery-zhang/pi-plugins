# 01: 按当前模型替换 Pi 默认提示词

**What to build:** 用户可临时加载独立插件，在 Hydrogen 上自动使用已验证能正常发出请求的短提示词，继续使用 Pi 的工具与项目上下文；切换模型或提供自己的系统提示词时按原有规则工作。参见[规格](../spec.md)。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] 公共包 `@jingoz/pi-prompt-replace` 可按仓库规范用 `pi -e` 临时加载；使用公开提示词钩子，Pi 1.5.0 为最低支持版本，不以精确版本或 `1.5.x` 限制后续版本。
- [x] 仅 `muryo/gemini-4-hydrogen-sonar` 使用替代前缀；保留 Pi 实际工具定义与宿主组装的工程上下文，已有自定义前缀或完整覆盖时不替换，缺少所需结构化选项时保持宿主行为。
- [x] 本地模拟端点证明短提示词走插件和走 `--system-prompt` 等价；区别同 ID 不同 provider，验证切换模型及恢复旧会话后的请求，避免上一轮提示词残留在目标请求里。
- [x] 在 Pi 1.5.0 和 1.5.2 上实际触发钩子并记录结果；至少有一次无 UI 的临时加载冒烟。包级 `check`、`test` 通过，无需生产凭据。

## Comments

2026-11-18：已交付 `@jingoz/pi-prompt-replace@0.1.0`。扩展只在 `muryo/gemini-4-hydrogen-sonar` 且没有显式系统提示时修改 `before_agent_start.systemPromptOptions.customPrompt`；显式/forced prompt、其他模型和无模型均保持原行为。Pi 1.5.2 的本地 provider 冒烟确认实际请求包含替代提示词、角色为 developer/user，且默认 Pi 前缀未发出；Pi 1.5.0 的可执行包版本检查通过。`check`、4 项单测、local smoke 和 `npm publish --dry-run` 均通过。

## Answer

已完成。发布包不含测试和开发文件，可直接执行 `npm publish --access public`。
