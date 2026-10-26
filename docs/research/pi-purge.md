# pi-purge 调研记录

## 新会话接续

- 用户目标：参考本机已实测有效的 `D:\github\dsh-purge`，在本仓库设计自己的 pi-purge；用户提供的第三方 pi-purge 此前未达到预期效果。具体失败用例、当时版本/source/mode 尚未确认。
- 当前阶段：调研完成，插件尚未实现。下文的实现路线是建议，第一版范围与验收标准仍需明确；没有进行新的模型效果测试。
- 先读本仓库 `AGENTS.md` 与 [Pi 插件开发规范](./pi-plugin-development.md)。本仓库已经配置本地 Markdown issue 跟踪与领域文档，无需重复初始化技能配置。
- **版本边界：仓库声明的兼容基线是 Pi 0.84.3，本报告的本机接口证据是 Pi 1.4.0。实施前应验证目标版本的接口；本文不构成升级仓库基线的决定。**
- 下次优先确定成功验收用例与第一版目标，再建立同模型、同提示文件、同参数的请求/效果对照。可把本报告带入 `/grill-with-docs` 继续明确设计。
- 随附 [第三方 pi-purge 源码快照](./pi-purge-sources/upstream-pi-purge) 与 [Pi 1.4.0 三份固定版本源码](./pi-purge-sources/pi-1.4.0-sources)，保留上游许可证，不含嵌套 Git 元数据。原下载缓存留在旧工作目录。
- 本机 DSH 提示正文与凭据未复制进仓库；它们仍在报告所列原位置。继续调研时按需读取，避免把正文或密钥写入日志/提交。

调研日期：2026-10-26。核对了本机 DSH、dsh-purge、Pi 与第三方 pi-purge。未运行模型请求，未读取密钥，未修改 Pi/DSH 配置或安装插件。

**建议：先用 DSH 已有效的提示文件做同条件对照，再实现一个针对本机 Pi 1.4.0 的原生扩展，迁移提示词组装方式并加入请求观测。现有官方接口已经覆盖这项工作的主要需求；目前没有证据要求修改 Pi 安装文件或重写 provider。**

## 1. 版本与证据范围

- 用户提供的仓库 [jeffery-zhang/pi-purge](https://github.com/jeffery-zhang/pi-purge) 当前 `main` 已下载到 [上游副本](D:/Personal/pi-plugins/docs/research/pi-purge-sources/upstream-pi-purge)，固定提交为 [`5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb`](https://github.com/jeffery-zhang/pi-purge/tree/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb)，包版本 `0.2.3`。以下第三方插件结论只适用于这个提交，不代表用户此前实际安装的版本。
- 本机官方包是 `@earendil-works/pi-coding-agent 1.4.0`，核对了 [package.json](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/package.json)、已安装 `docs`、`dist` 与示例。官方现仓库是 [earendil-works/pi](https://github.com/earendil-works/pi)，`v1.4.0` 标签指向 [`4a080252f06caf63a525d7873c5d94d3c23887e0`](https://github.com/earendil-works/pi/tree/4a080252f06caf63a525d7873c5d94d3c23887e0)。旧 `badlogic/pi-mono` 链接会重定向；第三方 README 所写 `earendil-works/pi-coding-agent` 仓库 URL 当前返回 404，不能据此判断 npm 包不存在。

## 2. 第三方 pi-purge 实际做了什么

### 2.1 默认内容只是普通占位示例

**代码事实：** `EMBEDDED_PERSONA` 内容是普通的 “helpful assistant” 与使用说明，并明确说它是 placeholder；没有自动读取 DSH 的完整提示词。[源码第 18–45 行](https://github.com/jeffery-zhang/pi-purge/blob/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb/extensions/pi-purge.ts#L18-L45)

- 默认源是 `embedded`，默认模式 `strict`，默认关闭。`PI_PURGE_SOURCE` 只有在模块初始化时显式设置才成为初始源。
- `~/.dsh/prompt-inject.md` 只用作命令帮助中的提示路径，不会被自动探测或自动加载。
- 外部文件读取逻辑只有 UTF-8 读取、`.trim()`、空文件与读取失败检查；不解析或剥离 ChatML，也不把文件中的角色标记拆成 API 消息。[读取逻辑第 98–117 行](https://github.com/jeffery-zhang/pi-purge/blob/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb/extensions/pi-purge.ts#L98-L117)
- README 同时列出 `npm:pi-purge` 与另一个作者仓库的固定提交 `ZiChuanLan/pi-purge@ffafeb9`。它们不能自动视为用户提供仓库当前 `main` 的同一构建；本次未核对该历史固定提交内容。[README 安装章节](https://github.com/jeffery-zhang/pi-purge/blob/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb/README.zh-CN.md#L11-L36)

**推论：** 如果此前只是安装当前 `main`/对应占位版本，然后执行 `/purge`，实际上做的是“普通示例提示词替换”，与加载本机 DSH 的完整提示文件不是同一实验。这是明确的对照变量，不能单靠它断言用户此前失败的原因。

### 2.2 三种模式的精确边界

| 模式 | 改动的系统文本 | 仍保留的内容 |
| --- | --- | --- |
| `append` | 前置 `body` | Pi 原系统提示词全文 |
| `replace` | 前置 `body`；查找精确身份句，从命中位置删到该行末；查找精确文档起止标记并删除该段 | 工具说明、规则、项目上下文/AGENTS、skills、其他扩展文本等其余系统文本 |
| `strict` | 丢弃传入的整段 `event.systemPrompt`，改成 `body` 与可获得的工作目录 | 当前工具声明仍由 Pi 保存；非 system 对话历史不在该插件修改范围 |

证据：[`stripHostPersona` 第 58–96 行](https://github.com/jeffery-zhang/pi-purge/blob/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb/extensions/pi-purge.ts#L58-L96)、[`before_agent_start` 第 136–153 行](https://github.com/jeffery-zhang/pi-purge/blob/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb/extensions/pi-purge.ts#L136-L153)。

细节：

- 身份句和文档段是**独立匹配、独立删除**，并非“任一缺失则两段全都保留”。README 所说“退化 append”是简化描述。
- 本机 Pi 1.4.0 原身份首句与文档标记仍匹配；但 1.4.0 已将系统内容组织为 `<tools>`、`<rules>`、`<docs>` 等结构段。字符串删除文档正文会留下 `<docs>` 空外壳。strict 不依赖这些标记。
- `strict` 会丢掉项目规则与工具使用说明等有用信息；“schema 还在”不等于工具使用质量与原模式相同。
- `lastCut` 只检测输入 prompt 是否含两段标记，不是对最终发往服务端的 payload 审计；`append` 分支也不更新 `lastCut`，所以状态展示可能沿用更早一轮的删除记录。
- 只注册 `session_start`、`before_agent_start` 与 `/purge`；没有 `context`、`context_with_system`、`before_provider_request` 或 provider 包装。因此不会清理已存在的普通对话历史，也不会审计传输后的消息角色。

### 2.3 命令与测试的实际能力

`session_start` 将 `enabled` 复位为 false；它不把 `mode` 与 `source` 重置成初始值。文件正文在 session_start、on、source 等节点读取，并非每个模型请求都读取。README 声称存在 `/purge reload`，但命令 switch 没有 `reload` 分支，实际会进入“未知子命令”。[命令实现第 128–272 行](https://github.com/jeffery-zhang/pi-purge/blob/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb/extensions/pi-purge.ts#L128-L272)

仓库两套测试通过 stub 的 `pi.on`/`registerCommand` 手动调用回调，验证字符串变换、会话关闭、源失败回滚和无状态文件写入。它们**没有实例化真实 Pi 1.4.0、没有执行 provider 的请求转换，也没有验证任何模型行为**。其中 `REAL_PI_PROMPT` 是硬编码旧形状，不是运行时调用当前 Pi 生成器得到的 prompt。[主测试](https://github.com/jeffery-zhang/pi-purge/blob/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb/test/pi-purge.test.mjs)、[环境源测试](https://github.com/jeffery-zhang/pi-purge/blob/5e77c74579c86c5e9cf7ae2e4810d8b2f31a25fb/test/pi-purge-env-source.test.mjs)。本次只审阅，未运行这些测试。

## 3. 官方 Pi 1.4.0 可用的扩展切入点

### 3.1 `before_agent_start` 足以替换该轮完整系统提示词

本机 [扩展文档](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:216) 明确提供当前 `systemPrompt` 和可变的 `systemPromptOptions`。返回 `{ systemPrompt }` 会替换该轮完整系统提示词；也可直接修改结构项。

代码链路已经核对：

1. [runner.js:1121](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:1121) 按扩展顺序执行；返回的 `systemPrompt` 被存为 `forceSystemPrompt`，后续处理器能看见该结果。
2. [system-prompt.js:140](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js:140) 有 forced 文本时直接返回该文本；正常构建路径才组装身份、工具说明、规则、文档、上下文、skills 与 cwd。
3. [agent-session.js:1366](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1366) 在请求投影中构造一个 leading system，内容为 forced 文本、携带当前工具，然后过滤掉其余 system 消息。普通 user/assistant/toolResult 历史保留；原结构化 system 数据仍可留在会话记录中，但不是原样重发给 provider。

因此，不能将 Pi 当前版本的问题简单归因于“只改 before_agent_start，旧宿主 system 一定还残留在 API 请求里”；当前实现专门处理了这件事。仍须考虑后续扩展与 provider 转换。

官方源码入口：[runner.ts](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/extensions/runner.ts)、[agent-session.ts](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/agent-session.ts)、[system-prompt.ts](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/system-prompt.ts)。

### 3.2 `context` 与 `context_with_system` 不可混用

- `context` 在每次 LLM 调用前触发，但只接收非 system 对话；Pi 在每个处理器后恢复 prompt 与工具状态，不能靠它删掉系统提示词。
- `context_with_system` 才接收完整 transcript，其返回内容直接采用；必须保留 index 0 的 system，否则会丢失 prompt 与初始工具声明。仅在需要拥有完整 transcript 的请求级变换时使用。
- 官方顺序是 `context` → `context_with_system` → `before_provider_headers` → `before_provider_request` → `after_provider_response` → stream 观察事件。forced prompt 投影在 context 变换后执行，还需结合具体投影调用链理解。

证据：[types.d.ts:675](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:675)、[runner.js:1001](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:1001)、[docs/extensions.md:94](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:94)。

### 3.3 `before_provider_request` 是最终请求观测点

本机事件实际存在，`event.payload` 类型为 `unknown`；回调可观察或直接返回替代 payload。它按扩展顺序链式传递，不会替用户验证替代值是否符合 provider 协议。[types.d.ts:692](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:692)、[runner.js:1066](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:1066)

SDK 将此事件连接到 `onPayload`；OpenAI Responses provider 在组装 `params` 之后、`client.responses.create()` 之前调用它并使用返回的替代值。[sdk.js:224](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js:224)、[openai-responses.js:139](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js:139)

官方示例 [provider-payload.ts](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/examples/extensions/provider-payload.ts) 会把完整请求记录到本地；实际项目宜默认只记录角色、字段名、字符数、hash 与已移除段名，避免把用户正文、工具输出写进日志。只观察 payload 不需要接管 provider。

### 3.4 当前 OpenAI Responses 的角色转换值得单独对照

**本机代码事实：** [openai-responses-shared.js:169](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js:169) 使用：

```ts
const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";
```

随后系统文本写入 Responses `input` 的该角色消息，而工具声明根据能力走独立工具字段/工具项。[openai-responses.js:247](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js:247)、[官方固定版本源码](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/ai/src/api/openai-responses-shared.ts)

**条件性推论：** 对于 `reasoning: true` 且未显式禁用 developer role 的 Responses 模型，文件即使被称为 system prompt，Pi 发出时也可能是 developer 消息。DSH 当前使用的嵌套 Pi AI 实现也有同类转换逻辑，因此不能将 developer role 直接当作两者差异或失败根因。尚未抓取实际请求，也未验证网关最终映射。

### 3.5 `registerProvider` 可用，但不是首选迁移路径

官方 `pi.registerProvider()` 可复用内置 API、调整 endpoint/auth/模型定义；只有协议无法表达时才需要 `streamSimple`。自己实现 stream 还要承担文本、thinking、工具调用、usage、终止、取消与错误处理，并调用 `options.onPayload`/`onResponse`/`onProviderStreamEvent`，否则扩展审计钩子可能失效。[本机 custom-provider.md:162](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md:162)、[官方文档固定版本](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/docs/custom-provider.md)

仅替换 prompt 或检查实际请求不需要复制 streaming 实现；优先沿用 Pi 的 hooks 和现有 provider。

## 4. 尚未证明的部分

- 用户此前安装的是哪个提交/来源，是否执行过 `/purge on`，是否加载外部提示文件，以及当时最终 payload 的角色与内容。
- 同一模型标识是否经 DSH 和 Pi 路由到完全相同的后端、参数与服务端系统策略。
- DSH 与 Pi 的提示词正文、ChatML 字面外壳、对话历史、工具声明、reasoning 参数等变量各自对输出的影响。
- 本文的字符串与调用链结论来自静态源码；没有模型效果测试，也没有运行真实 Pi 集成回归。

## 5. 本机 DSH 的实际工作方式

### 5.1 研究的是本机有效版本

- 本地仓库 [D:/github/dsh-purge](D:/github/dsh-purge) 的 HEAD 是 `033e6bd1e0f101352b39075ecd0d758ffef26b76`，包版本 `1.1.71`；remote 是 [mmparko/dsh-purge](https://github.com/mmparko/dsh-purge)，包元数据标明原来源 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)。本地有三处既存兼容修改，分别涉及 `{{cwd}}`、persona suffix 与 Windows 备份句柄；调研保留这些改动。
- 本机 DSH 是 `0.2.1-rc.2`，Web profile 的依赖确实链接至 `D:/github/dsh-purge`，不是另一份 npm 副本。[profile package.json](C:/Users/0116/.dsh/profiles/web/package.json)
- 当前 [prompt-inject.md](C:/Users/0116/.dsh/prompt-inject.md) 为 30,017 字节、23,175 字符、266 行，SHA256 为 `4487C0B46067A795C6B1210A596B8580E832ABAF889558897F1FF51FFB994EA6`。仅检查文件结构与摘要，没有复制正文到本项目。用户报告该环境已实测有效，本轮未重测模型效果。

### 5.2 它至少覆盖三层

| 层 | 本机源码实际行为 | 对 Pi 迁移的意义 |
| --- | --- | --- |
| 提示词来源 | 内存已提交正文 → `prompt-inject.md` → 内置封装默认值 | 要复用有效正文，不能把普通占位文案当作同一提示词 |
| 组装与生命周期 | 删除默认身份段、按策略处理 workspace baseline、去掉 mnemon 段；把注入放在首位，保留其余功能段；每步和首轮均有保证注入的路径 | 借鉴来源、顺序、完整性和多轮一致性；用 Pi 自己的接口实现 |
| DSH 宿主与工具 | 对已安装包做补丁，涉及审批、沙箱、工具上限、预设、会话和升级兼容等 | 这些解决的是 DSH 的具体实现；不能据补丁数量推断模型效果，也无需整套搬到 Pi |

来源：[提示词解析 rules.js:243](D:/github/dsh-purge/lib/rules.js:243)、[组装 identity.js:892](D:/github/dsh-purge/lib/identity.js:892)、[注入置顶 identity.js:311](D:/github/dsh-purge/lib/identity.js:311)、[运行组装 index.js:498](D:/github/dsh-purge/lib/index.js:498)、[宿主补丁清单 core.js:2523](D:/github/dsh-purge/lib/core.js:2523)、[首条 system 更新与首轮组装补丁 core.js:4517](D:/github/dsh-purge/lib/core.js:4517)。

当前没有显式 workspace-policy 文件，源码默认策略是 `fallback`；有效注入存在时移除宿主 workspace baseline。此判断是源码和配置推导，不是本轮运行时 dump。[rules.js:28](D:/github/dsh-purge/lib/rules.js:28)、[index.js:508](D:/github/dsh-purge/lib/index.js:508)

**DSH 也不是只发一份孤立人设。** 当前组装把完整注入放在首位，随后可以追加 capability protocol 和保留的工具/功能段；`assembled.tools` 仍被保留。Pi 的 strict 会连项目规则和技能目录一起删掉，因此“strict 越干净就一定越接近 DSH”并不成立。[identity.js:918](D:/github/dsh-purge/lib/identity.js:918)、[identity.js:972](D:/github/dsh-purge/lib/identity.js:972)、[capability-protocol.js](D:/github/dsh-purge/lib/capability-protocol.js)

### 5.3 不应误判的两个细节

1. DSH 的 `peelChatmlEnvelope()` 名称容易误导：当前实际仅整理换行/标签闭合，保留字面 ChatML 外壳；第三方 pi-purge 读取文件也不剥离它。因此目前没有证据表明是 pi-purge 自动删掉了外壳。字面标签是否影响网关/模型，只能实测，不能等同于真实 API 角色。[identity.js:43](D:/github/dsh-purge/lib/identity.js:43)
2. DSH 的 `autoRetry` 针对请求失败，有永久错误与取消判定；没有证据说明它靠识别普通拒答文本并不断重试来达到效果。不应把这当作第一版必备功能。[continue-retry.js:90](D:/github/dsh-purge/lib/continue-retry.js:90)

## 6. 本机两条请求链的已知共同点与差异

| 项目 | DSH Web 当前配置 | Pi 当前配置/源码 |
| --- | --- | --- |
| 网关 | `https://cpa.muryorouter.cc/v1` | 相同 |
| API | `openai-responses` | 相同 |
| provider / model | `muryo / deepseek-v4.1-flash` | 相同 |
| 推理声明 | `reasoningEfforts: low/high/max`，profile `reasoningEffort: max` | 模型 `reasoning: true`；settings 未显式保存默认 thinking level，本轮未确认会话实际档位 |
| 底层请求库 | 嵌套 `@earendil-works/pi-ai 1.3.0` | Pi 1.4.0 对应的 pi-ai 实现 |
| 指令角色 | 当前 reasoning 声明与默认兼容分支下可转成 `developer` | 同类分支；不能将其单独解释为效果差异 |
| 提示词 | 存在完整本地文件，另有组装处理 | 第三方当前版本默认是占位正文；用户此前实际 source/mode 未知 |

配置来源：[DSH profile](C:/Users/0116/.dsh/profiles/web/cordis.patch.yml:7)、[Pi models](C:/Users/0116/.pi/agent/models.json)、[Pi settings](C:/Users/0116/.pi/agent/settings.json)。只读取/展示了非秘密字段。DSH adapter 的 [依赖清单](C:/Users/0116/.bun/install/global/node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json)、[推理声明物化 index.js:585](C:/Users/0116/.bun/install/global/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js:585)、[Responses 角色转换 openai-responses-shared.js:131](C:/Users/0116/.bun/install/global/node_modules/@deepseek-ai/dsh-llm-pi-ai/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js:131)。

这说明应先控制提示正文、组装、实际推理档位、历史与工具差异；相同 URL 和 model 名仍不能证明代理服务内部路由完全相同。本轮没有抓包或访问网关管理接口。

## 7. 推荐实施顺序

### 第一步：先定位差异，作为新插件的验收基线

用临时加载的扩展、全新会话和本机已有效的 DSH 提示文件做对照。固定网关、模型、API、推理档位与用户输入；明确记录第三方插件的版本、启用状态、source 和 mode。先验证文件摘要与传输后的指令摘要相符，再比较模型行为。单纯让模型复述某个标记，只能证明传输，不能证明预期行为已经达成。

请求观测先只输出：API、模型、指令角色、字符数/hash、消息顺序、工具名称、reasoning 参数。需要完整对比时才临时采集本地正文，并明确保存位置。调研没有生成完整请求日志。

### 第二步：做一个薄的原生 Pi 扩展

最小范围是一份扩展入口、一个外部提示文件、启停/状态命令、少量组装逻辑和必要检查：

- `before_agent_start`：明确读取的来源并构建本轮提示词，保持正文完整、置于前部；状态显示来源、长度、hash 和生效状态。第一版先围绕已验证的单一模型工作。
- 在 Pi 1.4.0 的结构化系统提示接口可满足需求时，按结构处理身份和工具说明；完整 forced prompt 可作为隔离对照手段。不要依赖整段英文提示词的脆弱字符串截断作为长期实现。
- `before_provider_request`：观察最终序列化结果，确认其他扩展和 provider 没有改变预期。只有证据证明传输兼容有问题，才增加针对该 API 的最小修正。
- 保留当前工具 schema，并核对提示词中的 DSH 专用工具名、路径、变量；向 Pi 的实际能力做必要适配。原始正文留作对照，不先大幅改写。
- 文件缺失/空文件时明确报告并恢复正常路径；停用后恢复 Pi 的默认提示组装。无需修改任何安装文件。

### 第三步：验证真正容易出问题的生命周期

离线检查覆盖来源失败、重复注入、开关恢复与正文完整性；真实 Pi 集成覆盖首轮、第二轮、工具调用后的下一次请求、切换会话/模型、压缩后的继续请求。模型效果用用户已验证过的输入做相同条件对照，分别记录“提示传输正确”“工具链正常”“模型达到预期”，不能互相代替。

**第一版暂不引入：** DSH 二进制/安装补丁、沙箱与审批改造、演练台、自动更新、自动重试、多 provider 抽象或自写 SSE 流式解析。现有证据没有表明这些是本次目标的前置条件。

### 来源与分发

如实际复用 DSH 或第三方 pi-purge 的代码/提示词，应保留来源与版权声明。本地 DSH [LICENSE](D:/github/dsh-purge/LICENSE) 是 MIT，README 另写署名和商业使用要求；准备公开分发时需要核对对应材料的授权边界。本轮仅保存研究笔记与第三方源码副本，没有复制本机提示正文，也没有制作可分发插件。
