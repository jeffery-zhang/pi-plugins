# Pi 复用 Codex Chrome 扩展的可行性

## 结论

可以实现，但当前只能基于 Codex 的本机私有接口，不能视为 OpenAI 支持的第三方集成 API。

在本机环境中已经完成一次只读验证：普通 Node.js 进程动态加载 Codex 随附的 `browser-client.mjs` 与 `browser-service.mjs`，通过活动的 `codex-browser-use` Windows named pipe 成功发现官方 Chrome 扩展后端。探针只读取浏览器后端元数据，没有读取标签页或控制页面。

建议先实现一个依赖本机 Codex 安装的 Pi 适配器 MVP，不复制或分发 Codex 的私有代码。若后续需要可发布、跨版本稳定的插件，则应改用自有 Chrome 扩展和自有 native messaging host。

## 已确认的架构

本机安装产物显示连接链路如下：

```text
Pi extension
  -> local adapter
  -> Codex browser-service.mjs / browser-client.mjs
  -> \\.\pipe\codex-browser-use\<id>
  -> Codex browser backend
  -> Chrome native messaging host
  -> ChatGPT Chrome extension
  -> chrome.debugger / tabs / downloads / history
```

### Chrome 扩展

本机 ChatGPT Chrome 扩展清单包含：

- `nativeMessaging`
- `debugger`
- `tabs`
- `history`
- `downloads`
- `<all_urls>` host permission

扩展通过 `chrome.runtime.connectNative("com.openai.codexextension")` 连接本机 native host。扩展与 native host 之间使用 JSON-RPC 2.0，并包含 `codexRuntime/hello`、`codexRuntime/ensure` 等版本协商调用。

本机 native host 清单位于 `%LOCALAPPDATA%/OpenAI/extension/com.openai.codexextension.json`。它只允许官方 Chrome/Edge 扩展 ID，并启动 Codex 缓存中的 `extension-host.exe`。

### Codex 浏览器服务

Codex 的 Chrome 插件缓存位于：

```text
%USERPROFILE%/.codex/plugins/cache/openai-bundled/chrome/latest/
```

关键文件：

- `.codex-plugin/plugin.json`
- `scripts/browser-client.mjs`
- `scripts/browser-service.mjs`
- `docs/api.json`
- `skills/control-chrome/SKILL.md`

`browser-client.mjs` 不是独立客户端。它要求受信任的 `globalThis.nodeRepl.rpc("browser", ...)` 服务。

`browser-service.mjs` 暴露 `handleRpc`，并通过特权 `nativePipe.createConnection()` 枚举和连接以下后端：

```text
Windows: \\.\pipe\codex-browser-use\*
Unix:   /tmp/codex-browser-use*
```

后端传输使用 4 字节长度前缀和 JSON-RPC 2.0 消息。上层 API 包括浏览器发现、标签页列表/认领、导航、DOM/可访问性快照、截图、Playwright 风格定位器、CDP、下载和历史记录等。

## 只读验证结果

本机存在活动 `codex-browser-use` named pipe。通过最小特权适配器执行：

1. 动态导入本机 `browser-service.mjs`。
2. 为其提供 named pipe、配置读取、元数据和拒绝式确认实现。
3. 动态导入 `browser-client.mjs`。
4. 调用 `setupBrowserRuntime()`。
5. 调用 `agent.browsers.list()`。

结果成功返回一个 `family: "chrome"`、`type: "extension"` 的浏览器后端，并识别到官方扩展 ID。这证明 Pi 可以在当前本机版本上复用现有扩展，不需要安装第二个 Chrome 扩展。

## 实现方案

### 方案 A：本机私有服务适配器，推荐用于 MVP

新增 `packages/codex-chrome-bridge/`：

- 启动时定位 Codex Chrome 插件的 `latest` 目录。
- 首次使用时创建 browser service 运行时并连接活动 named pipe。
- 将 Pi 会话 ID/turn 信息映射为浏览器后端需要的请求元数据。
- 把 Codex 的 elicitation 映射到 Pi UI 确认；无 UI 模式一律拒绝有副作用或需要授权的操作。
- 注册 `/chrome-status` 命令。
- 注册严格 TypeBox 参数的浏览器工具。
- 在 `session_shutdown` 幂等关闭 pipe、socket 和持有的标签页句柄。

建议 MVP 工具范围：

- `status`
- `list_tabs`
- `claim_tab`
- `new_tab`
- `navigate`
- `snapshot`
- `screenshot`
- `click`
- `fill`
- `press`
- `close_tab`

首版不开放原始 CDP、历史记录、任意页面脚本和文件上传。这些能力的权限和数据泄露风险更高。

优点：直接复用官方扩展、当前 Chrome 登录态和官方 browser backend。

限制：

- 必须安装 Codex/ChatGPT Desktop、Chrome 插件和官方扩展。
- 接口是私有且版本耦合的，Codex 更新可能导致适配器失效。
- 本机插件声明为 `Proprietary`，不能把其代码复制进本仓库或随 Pi 插件分发。
- 应动态加载用户本机已有文件，并在缺失或版本不兼容时明确报错。

### 方案 B：Codex sidecar

Pi 把高层浏览器任务委托给 `codex app-server` 或 `codex exec`，由 Codex 自己使用 Chrome 插件。

优点是协议维护较少；缺点是多一层 agent、额外模型调用、延迟更高，而且很难向 Pi 暴露稳定的低层标签页句柄。适合作为降级路径，不适合作为最终浏览器工具。

### 方案 C：自有 Chrome 扩展

实现自己的 MV3 扩展、native messaging host 和 Pi 协议。这是最稳定且可发布的方案，但不能复用用户已经安装的官方扩展。

不建议替换注册表中的官方 native host，或代理/劫持 `com.openai.codexextension`。这会与 Codex Desktop 争用连接，并可能在升级时破坏官方安装。

## 安全要求

官方文档明确说明该扩展能使用登录态、页面内容、历史记录、下载和调试器权限。Pi 适配器必须保留同等级别的防护：

- 新站点首次访问前确认 origin。
- 发送消息、提交表单、购买、删除、上传、凭据和敏感数据传输时，在动作发生前再次确认。
- 无 UI 模式默认 fail closed。
- 页面内容视为不可信输入，不能把网页文字当成用户授权。
- 日志不得记录 cookie、凭据、OTP、页面敏感内容或完整浏览历史。
- 不通过原始 CDP 绕过上层确认逻辑。

## 推荐实施顺序

1. 做 Windows-only、read-only 原型：`status`、`list_tabs`、`snapshot`、`screenshot`。
2. 增加标签页认领和语义操作：`navigate`、`click`、`fill`、`press`。
3. 接入 Pi UI 确认和会话清理。
4. 固定兼容版本探测，并为 Codex 自动更新后的不兼容提供清晰错误。
5. 再评估 macOS/Linux、文件传输、历史记录和 CDP。

## 来源

- OpenAI 官方 Chrome 扩展文档：<https://developers.openai.com/codex/app/chrome-extension>
- 本仓库 Pi 插件开发基线：[`docs/research/pi-plugin-development.md`](./pi-plugin-development.md)
- 本机 Codex Chrome 插件清单：`%USERPROFILE%/.codex/plugins/cache/openai-bundled/chrome/latest/.codex-plugin/plugin.json`
- 本机 Codex 浏览器 API：`%USERPROFILE%/.codex/plugins/cache/openai-bundled/chrome/latest/docs/api.json`
- 本机 Codex browser client/service：`%USERPROFILE%/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/`
- 本机 Chrome 扩展清单：Chrome profile 下的扩展 ID `hehggadaopoacecdllhhajmbjkdcmajg`
