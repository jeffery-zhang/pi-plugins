# Hydrogen 默认提示词兼容验证记录

日期：2026-11-18

## 包与自动检查

- `pnpm --filter @jingoz/pi-prompt-replace check`：通过。
- `pnpm --filter @jingoz/pi-prompt-replace test`：4/4 通过，覆盖目标模型、其他模型、显式/forced prompt、无模型和规则 helper。
- `pnpm --filter @jingoz/pi-prompt-replace smoke`：通过。Pi 通过本地模拟 `openai-completions` 端点实际加载扩展；请求角色为 `developer`、`user`，替代提示词存在，Pi 默认前缀不存在，响应正常结束。
- `npm publish --dry-run --access public`（在包目录执行）：通过。发布清单只有 `LICENSE`、`README.md`、`package.json` 和 `src/index.ts`；没有执行实际发布。

## Pi 宿主

- 当前本机 Pi 1.5.2：`pi --no-extensions -e ./packages/pi-prompt-replace --model muryo/gemini-4-hydrogen-sonar --thinking high --print --no-session --no-tools ...` 返回预期短回复。
- Pi 1.5.0：`pnpm dlx --package @earendil-works/pi-coding-agent@1.5.0 pi --version` 返回 `1.5.0`；检查 1.5.0 发布包类型定义确认包含 `before_agent_start` 和 `systemPromptOptions`。插件只依赖这两个公开字段；完整集成在 1.5.2 上实测。

## Hydrogen 真实工具任务

在临时目录中用实际 `muryo/gemini-4-hydrogen-sonar`、`openai-completions`、`high` 和插件执行最小工具任务：模型创建并读回 `smoke.svg`，文件为有效 SVG，含 10×10 红色矩形，并回复 `HYDROGEN_TOOL_SMOKE_OK`。临时文件路径未纳入仓库，凭据未输出。

这证明当前模型、Pi 工具链和提示替换组合可工作；它不证明所有上游策略、配额状态或其他模型都兼容。
