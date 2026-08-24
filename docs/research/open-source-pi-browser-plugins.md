# GitHub 上的 Pi 浏览器插件调研

## 结论

已经存在多个开源 Pi 浏览器插件，但它们分成三类：

1. 自有 Chrome companion extension，直接控制用户现有 Chrome。
2. 通过 CDP/remote debugging 控制现有 Chrome。
3. 启动独立 Chromium 或持久化自动化 profile。

最接近 Codex Chrome 使用体验、也最适合作为现成方案的是 [`tianrendong/pi-chrome`](https://github.com/tianrendong/pi-chrome)。

唯一明确尝试复用 Codex AppServer 和官方 ChatGPT Chrome 扩展链路的项目是 [`unstableneutron/pi-toolbox/extensions/pi-codex-app-server-use`](https://github.com/unstableneutron/pi-toolbox/tree/main/extensions/pi-codex-app-server-use)，但它依赖私有 Codex 运行时、Chrome remote debugging 和全局 Codex daemon，当前没有独立 npm 包。

## 候选项目

### 1. tianrendong/pi-chrome

- GitHub：<https://github.com/tianrendong/pi-chrome>
- npm：`pi-chrome`
- 许可证：MIT
- 调研时约 46 stars、19 forks
- Pi 基线：`@earendil-works/pi-coding-agent`

架构：

```text
Pi chrome_* tools
  -> 127.0.0.1:17318 loopback bridge
  -> unpacked Chrome extension
  -> chrome.debugger / tabs / scripting
  -> user's existing Chrome profile
```

特点：

- 使用用户真实 Chrome profile、登录态、cookies 和已有扩展。
- 不需要 `--remote-debugging-port`。
- 每个 Pi 会话需要显式执行 `/chrome authorize`，默认锁定。
- 支持多 Pi 会话，每个会话拥有独立 automation target。
- 提供 snapshot、稳定 element UID、截图、点击、输入、导航、标签页、网络和 console 等工具。
- 提供 `/chrome onboard`、`/chrome doctor`、状态和后台模式。
- 仓库包含 42 个 primitive challenge 和 BrowserGym 风格测试场景。

限制：

- 必须另外加载它自己的 unpacked Chrome extension，不能直接复用官方 ChatGPT 扩展。
- 当前有一个未关闭 issue 报告特定网站标签页可能被关闭，需要安装前复核最新修复状态。
- Chrome 扩展具有广泛权限，仍需审计源码。

判断：现阶段最佳现成方案。若“必须复用官方扩展”不是硬约束，应优先试用它，而不是重新开发。

### 2. unstableneutron/pi-toolbox / pi-codex-app-server-use

- GitHub：<https://github.com/unstableneutron/pi-toolbox/tree/main/extensions/pi-codex-app-server-use>
- npm：未发布独立包
- 许可证：仓库 MIT；Codex 本机产物仍受其原许可证约束
- Pi 基线：`@earendil-works/pi-coding-agent >= 0.84.1`

架构：

```text
Pi codex_browser_* tools
  -> running Codex AppServer daemon
  -> node_repl browser-client
  -> Codex browser backend / official Chrome extension
```

特点：

- 明确提供 Codex browser automation。
- `codex_browser_list` 列出浏览器和标签页。
- `codex_browser_eval` 在 browser-client runtime 中运行 JavaScript。
- 优先使用 Codex `node_repl` 浏览器 runtime；Chrome bridge 不可用时回退到直接 Chrome debugging。
- 有 doctor、设置 UI、取消处理和较完整的单元测试。
- vendor 目录中的 Codex Chrome extension/plugin 仅声明为研究快照，不接入运行时。

关键限制：

- 不负责启动 Codex AppServer，要求全局 daemon 已运行。
- 为唤起官方扩展 bridge，它会连接 `http://127.0.0.1:9224` 的 Chrome DevTools，定位官方扩展 service worker，并发送 `ensure_codex_app_server`。
- 因此浏览器需要打开 remote debugging；源码错误提示主要按 Brave `--remote-debugging-port=9224` 编写。
- 依赖 Codex 私有 `browser-client.mjs`、Node REPL 和版本匹配。
- 浏览器工具只有 list 和通用 eval 两个，模型使用体验不如细粒度原生工具。
- 没有独立 npm 发布，使用前需要从 monorepo 提取或本地安装。

判断：这是最接近“Pi 复用官方 Codex/ChatGPT Chrome 扩展”的开源参考实现。适合借鉴或验证，不建议未经修改直接作为长期方案。

### 3. patriceckhart/pi-chrome-operator

- GitHub：<https://github.com/patriceckhart/pi-chrome-operator>
- npm：`@patriceckhart/pi-chrome-operator`
- 许可证：MIT
- 调研时约 6 stars、3 forks

架构：

```text
Chrome side panel
  <-> WebSocket bridge
  <-> dedicated Pi RPC process
  <-> browser_action tool
```

特点：

- 自带 Chrome side panel 聊天 UI。
- 能控制所有标签页，支持 DOM 读取、点击、输入、导航和 routines。
- 自带一个专用、禁用编码工具的 Pi 浏览器 agent。

限制：

- 更像“在 Chrome 里运行 Pi”，而不是给当前 Pi 编码会话增加浏览器工具。
- 需要单独启动 bridge 和加载它自己的 unpacked extension。
- 发布较早，工具和安全模型没有 `pi-chrome` 完整。

判断：适合希望在 Chrome side panel 内直接聊天的用户，不是当前需求的首选。

### 4. amankumarsingh77/pi-browser-harness

- GitHub：<https://github.com/amankumarsingh77/pi-browser-harness>
- npm：`pi-browser-harness`
- 许可证：MIT
- 调研时约 20 stars、6 forks

特点：

- 原生 Pi 扩展，约 40 个浏览器工具。
- 通过 CDP 控制用户正在运行的 Chrome/Brave/Edge。
- 支持真实 profile、稳定 AX refs、截图、网络、console、文件和 raw CDP。
- Windows named pipe 问题已有关闭的修复 issue。

限制：

- 必须在 `chrome://inspect/#remote-debugging` 授权，或以 `--remote-debugging-port=9222` 启动浏览器。
- 默认只写入会话拥有的独立窗口/标签页；用户现有标签页主要用于只读查看。
- `browser_run_script` 等能力拥有完整 Node/CDP 权限，安全面较大。

判断：不想安装浏览器扩展、可以接受 remote debugging 时，这是最强的现成选项之一。

### 5. narumiruna/pi-extensions / pi-chrome-devtools

- GitHub：<https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-chrome-devtools>
- npm：`@narumitw/pi-chrome-devtools`
- 许可证：MIT
- 主仓库调研时约 407 stars

特点：

- 原生 CDP 工具，维护活跃，兼容当前 Pi。
- 可连接现有 `127.0.0.1:9222`，连接失败时自动启动隔离 Chromium。
- 工具范围较小：页面列表、选择、导航、evaluate、截图。
- 有延迟工具加载、配置 UI、路径校验和生命周期清理。

限制：

- 要复用现有 Chrome，仍需要标准 CDP discovery endpoint。
- 自动启动时使用隔离 profile，不是用户正常 Chrome 登录态。

判断：更适合前端调试和截图，不是完整 Codex Chrome 替代品。

### 6. TGYD-helige/pi / pi-browser-use

- GitHub：<https://github.com/TGYD-helige/pi/tree/master/packages/pi-browser-use>
- npm：`@amaster.ai/pi-browser-use`
- 许可证：Apache-2.0

特点：包装 Google `chrome-devtools-mcp`，动态代理其工具；支持 persistent、isolated 和 existing 三种模式。

限制：existing 模式依赖 `browserUrl`、`wsEndpoint` 或 CDP 自动发现。默认 persistent profile 位于 `~/.pi/browser-profile`，不是用户当前正常 Chrome profile。

判断：需要完整 chrome-devtools-mcp 工具集时可用，但连接路径与官方 Codex 扩展无关。

### 7. agent-browser wrappers

- <https://github.com/fitchmultz/pi-agent-browser-native>，npm `pi-agent-browser-native`
- <https://github.com/coctostan/pi-agent-browser>，npm `pi-agent-browser`

这两者都包装 Vercel `agent-browser`。功能完善、支持持久 profile 和截图，但通常运行独立自动化 Chromium，不直接复用官方 Codex Chrome 扩展。`pi-agent-browser-native` 维护和测试更强，适合独立浏览器自动化，不适合当前“使用已打开浏览器”这一硬要求。

## 不建议的项目

[`steimerbyte/pi-chrome-noauth`](https://github.com/steimerbyte/pi-chrome-noauth) 是 `pi-chrome` 的授权绕过 fork，描述明确称它把 manual authorization 改成 always-auth。它削弱了控制真实登录态浏览器时最关键的安全边界，不建议使用。

## 推荐顺序

### 目标是尽快可用

1. 试用 `pi-chrome`。
2. 审计其 Chrome extension 权限和未关闭 issue。
3. 在非主 Chrome profile 做第一轮验证。

### 目标是必须复用官方 ChatGPT Chrome 扩展

1. 以 `pi-codex-app-server-use` 为实现参考。
2. 不复制其 vendor 快照；动态使用本机 Codex 当前版本文件。
3. 优先采用已经验证成功的 `codex-browser-use` named pipe 发现方式。
4. 仅在后端 pipe 不存在时，评估它的 DevTools service-worker bootstrap 作为可选恢复路径。

### 目标是不安装任何 Chrome 扩展

优先比较：

1. `pi-browser-harness`，工具全面，复用现有 profile，但要求 remote debugging。
2. `@narumitw/pi-chrome-devtools`，工具较少但实现规整、维护活跃。
3. `@amaster.ai/pi-browser-use`，需要完整 chrome-devtools-mcp 工具面时使用。

## 来源

以上结论来自各项目的 README、package metadata、架构文档、核心实现、测试目录、GitHub commit/issue 元数据和 npm metadata。项目状态会变化，安装前应重新检查 release、未关闭 issue 和权限清单。
