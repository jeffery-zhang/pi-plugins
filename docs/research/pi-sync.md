# Pi Sync 调研记录

调研日期：2026-10-27。仅核对官方随包文档、必要的已安装源码与本机目录元数据；没有读取凭据值、修改 Pi 配置、安装扩展或请求模型。

## 1. 范围与版本

- 用户已明确：目标是保存和还原供应商、模型、扩展与配置，Key、Token 和鉴权由用户在每台机器自行配置。目录范围仅讨论 agent；“只保留 agent”目前按同步范围理解，不执行目录清理。
- 本机官方包为 `@earendil-works/pi-coding-agent@1.4.0`。[package.json:2](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/package.json:2)
- **仓库兼容基线仍为 0.84.3。本文记录 1.4.0 的行为，不构成升级基线的决定，也不证明两个版本的配置和扩展接口兼容。** 参见[仓库开发规范](./pi-plugin-development.md)。
- 下文“建议”和 P0 问题均未替用户作出决定；应结合 `.scratch/` 中的澄清记录确定首版范围。

## 2. agent 目录与资源范围

官方 agent 目录默认是 `~/.pi/agent`，支持 `PI_CODING_AGENT_DIR` 和 SDK `agentDir` 覆盖；实现不能把用户主目录下的默认路径写死。[configuration.md:9](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:9)、[config.js:491](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/config.js:491)

| 官方位置 | 内容与同步含义 | 证据 |
| --- | --- | --- |
| `settings.json` | 用户级设置、资源路径、包声明，需区分可移植设置与本机设置 | [configuration.md:13](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:13) |
| `models.json` | 兼容接口、模型定义和元数据覆盖，同时允许写入明文 Key 和 Header | [configuration.md:16](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:16)、[models-configuration.md:17](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md:17) |
| `keybindings.json` | 快捷键配置 | [configuration.md:14](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:14) |
| `mcp.json` | 用户级 MCP 定义，可含环境变量值、Header 和 OAuth client secret，不能直接整文件上传 | [mcp.md:32](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/mcp.md:32)、[mcp.md:62](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/mcp.md:62)、[mcp.md:146](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/mcp.md:146) |
| `auth.json`、`mcp-auth.json` | 分别存 Provider 和 MCP 登录凭据，应保持本机独有 | [providers.md:18](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/providers.md:18)、[mcp.md:129](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/mcp.md:129) |
| `AGENTS.override.md`、`AGENTS.md`、`AGENTS.MD`、`CLAUDE.md`、`CLAUDE.MD` | 全局用户指令；同一目录中的 override 文件会替代普通文件，需保留名称及优先级 | [configuration.md:18](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:18)、[configuration.md:45](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:45) |
| `SYSTEM.md`、`APPEND_SYSTEM.md` | 替换或追加系统提示；受信任项目中的同名文件优先于 agent 文件，不合并正文 | [configuration.md:19](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:19)、[configuration.md:39](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:39) |
| `extensions/`、`skills/`、`prompts/`、`themes/` | 用户资源的官方自动发现位置 | [configuration.md:21](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:21) |
| `models-store.json` | 动态刷新的供应商模型目录缓存，不等同于用户模型定义 | [models-store.d.ts:8](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/models-store.d.ts:8)、[models-store.js:30](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/models-store.js:30) |
| `mcp.log`、`mcp.log.1` | MCP 运行日志 | [mcp.md:98](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/mcp.md:98) |

**范围限制：** Pi 还会加载 `~/.agents/skills`、项目 `.pi`、祖先目录中的项目 `.agents/skills`、设置中指向的额外路径和 CLI 临时资源。仅保存 agent 不能等价于保存当前进程的全部有效环境。[skills.md:61](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/skills.md:61)、[settings.md:150](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:150)、[cli.md:217](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/cli.md:217)

## 2.1 本机 agent 目录观察

2026-10-27 的有限深度只读核对：当前进程未设置 `PI_CODING_AGENT_DIR`，默认 agent 目录实际存在以下内容。未读取 `auth.json`、会话正文或数据库；没有递归扫描完整依赖树。

```text
~/.pi/agent/
├── agents/                   # planner/reviewer/scout/worker.md
├── bin/fd.exe
├── extensions/subagent/      # index.ts、agents.ts
├── fff/                     # frecency/、history/
├── npm/                     # package.json、package-lock.json、node_modules/
├── prompts/                 # implement-and-review/implement/scout-and-plan.md
├── sessions/
├── auth.json
├── models-store.json
├── models.json
├── pi-fff.json
└── settings.json
```

- 本机没有 `skills/`、`themes/`、`keybindings.json`、`mcp.json` 或全局 AGENTS/SYSTEM 文件；这仅是本机观察，不是 Pi 能力限制。在上图已检查的有限层级中未发现 symlink/junction，完整缓存与依赖树不在此结论范围内。
- `settings.json` 只有 `defaultProvider`、`defaultModel`、`enabledModels`、`lastChangelogVersion`、`packages`。三个 npm 来源声明均未固定版本，没有配置目录外资源路径；未输出来源原始字符串。
- 已知直接包的公共 manifest 显示：`@ff-labs/pi-fff@0.11.0`、`@jingoz/pi-image-input@0.3.0`、`@jingoz/pi-purge@0.1.0`。这些是当前观察，不代表未来还原时自动得到相同版本。
- `models.json` 有一个自定义 Provider 和一个模型，`apiKey` 是环境变量引用，没有 Provider/模型 Header。仅记录形态，不记录引用所对应的凭据值。
- 本地 Subagent 的 `discoverAgents()` 从 `getAgentDir()/agents` 加载用户角色，还会根据 scope 选择最近的祖先项目 `.pi/agents`；同名项目角色可覆盖用户角色。本机 `agents/` 因而是配套用户资源，不能只收集原生资源目录。项目角色不在当前同步范围。[agents.ts:116](C:/Users/0116/.pi/agent/extensions/subagent/agents.ts:116)、[agents.ts:128](C:/Users/0116/.pi/agent/extensions/subagent/agents.ts:128)、[agents.ts:137](C:/Users/0116/.pi/agent/extensions/subagent/agents.ts:137)
- `pi-fff.json` 是持久化全局配置，本机只有 `mode`。该扩展还支持本机数据库路径、扫描范围和 symlink 策略，因此后续不能按整个文件都可移植推断。`fff/frecency`、`fff/history` 分别保存访问频率/最近程度和查询选择历史，应与配置区分。[pi-fff README:137](C:/Users/0116/.pi/agent/npm/node_modules/@ff-labs/pi-fff/README.md:137)、[README:183](C:/Users/0116/.pi/agent/npm/node_modules/@ff-labs/pi-fff/README.md:183)、[config.ts:10](C:/Users/0116/.pi/agent/npm/node_modules/@ff-labs/pi-fff/src/config.ts:10)、[paths.ts:29](C:/Users/0116/.pi/agent/npm/node_modules/@ff-labs/pi-fff/src/paths.ts:29)
- `bin/` 是 Pi 管理的 fd/rg 工具目录；工具管理器按系统和架构下载二进制。Windows 的 `fd.exe` 应由目标机器重新准备，不应复制到 macOS/Linux。[config.js:518](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/config.js:518)、[tools-manager.js:233](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/utils/tools-manager.js:233)

## 3. settings 的合并与可移植性

- 用户设置和项目设置分层；受信任项目的设置覆盖用户设置，资源列表在发现阶段组合。普通对象递归合并，普通数组并不是通用集合合并；`defaultTools` 另有继承和 `+/-` 规则。保存全局环境应读用户层，不能把当前项目合并后的有效设置直接导出为全局快照。[settings.md:3](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:3)、[settings-manager.js:19](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:19)、[settings-manager.js:95](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:95)、[settings-manager.js:332](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:332)
- 默认 Provider、模型、思考等级和启用模型模式属于启动配置；恢复旧会话还会恢复会话自己的模型和思考等级，不会因此改变新会话默认值。[settings.md:13](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:13)、[models.md:35](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:35)
- `externalEditor`、`shellPath`、`shellCommandPrefix`、`npmCommand`、`httpProxy`、`sessionDir` 都有本机路径、命令或网络语义，不宜未经选择直接迁移；`defaultProjectTrust` 是信任策略，不应默认为普通界面偏好。[settings.md:33](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:33)、[settings.md:36](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:36)、[settings.md:66](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:66)、[settings.md:125](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:125)、[settings.md:142](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:142)
- 用户资源相对路径从 agent 目录解析，项目资源从项目 `.pi` 解析；绝对路径和 `~` 都受支持。导出时需要对路径范围作判断，不能只换 Windows 的路径分隔符。[settings.md:150](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:150)

## 4. Provider、模型与鉴权

- 供应商可以来自内置目录、`models.json` 或可执行 Provider 扩展；只保存 `models.json` 无法重建扩展提供的自定义协议或动态发现逻辑，应同时保存其可重建的扩展来源。[custom-provider.md:3](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md:3)、[custom-provider.md:21](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md:21)
- 模型定义按 Provider 下的模型 ID 添加/替换；`modelOverrides` 只修改已有的内置或扩展模型，未知 ID 被忽略。内置模型目录来自 Pi 版本及缓存更新，不能承诺仅复制默认模型 ID 就能跨 Pi 版本得到相同能力。[models.md:15](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:15)、[models.md:67](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:67)、[models-configuration.md:61](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md:61)
- `apiKey` 和 Header 支持字面值、`$NAME`/`${NAME}` 环境变量插值和 `!command`。因此仅排除 `auth.json` 不足以排除秘密；保留“纯变量引用”与允许“任意带变量的字符串/命令”是不同的安全范围。[models-configuration.md:17](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md:17)、[models.md:65](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:65)
- Header 可以出现在 Provider、模型和 `modelOverrides` 层，脱敏与本机鉴权保留规则需要覆盖各层；不应假定都集中在 Provider 顶层。[models-configuration.md:20](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md:20)、[models-configuration.md:56](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md:56)、[models-configuration.md:86](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md:86)
- 无需鉴权的本地接口也可能配置固定 dummy key：官方 Ollama 示例使用字面值 `ollama`，用来让 Pi 将模型视为可用。自动删除所有字面 `apiKey` 会影响这种配置；首版必须明确由用户补 dummy key，还是允许显式标注的非秘密常量。[models.md:49](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:49)、[models.md:65](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:65)
- `/model` 只显示有可用凭据的模型。因此“配置还原成功但模型暂时不可选”可能是符合需求的待鉴权状态，应与配置损坏区分。[models.md:27](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:27)

## 5. 包与扩展的重建

- Pi 包可以从 npm、Git、URL 或本地路径加载；用户级安装声明写入 agent 的 `settings.json`，`-l` 则写项目 `.pi/settings.json`。[packages.md:9](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md:9)、[packages.md:19](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md:19)
- 直接写明 npm 版本、Git tag 或 commit 的来源是固定声明。若原声明没有固定版本，仅保存原声明不能保证另一台机器安装到当前版本；固定“实际安装版本/提交”需要额外采集。[packages.md:38](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md:38)
- `packages` 的对象形式还有 `extensions/skills/prompts/themes` 资源筛选；省略字段、空数组、`!pattern`、`+path`、`-path` 语义不同，导出成简单来源字符串会丢失启用状态。[packages.md:96](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md:96)、[packages.md:111](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md:111)
- 同一包在用户层和项目层按身份去重；项目条目通常替代用户条目，`autoload: false` 的项目条目改为筛选增量。内置扩展也可以通过 `extensions` 的 `+/-builtin:<name>` 配置启用状态。[packages.md:125](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md:125)、[settings.md:163](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:163)
- 本地路径只加载，不复制、不安装依赖；相对路径从声明它的 settings 文件解析。单文件可作为扩展，目录按包规则发现。因此同步本地扩展源码与仅保存原本地路径是不同承诺。[packages.md:40](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md:40)、[packages.md:88](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/packages.md:88)
- **写入包声明再 reload 已经可能产生安装行为。** `resource-loader.reload()` 会执行包解析；未提供 `onMissing` 时，包管理器会安装缺失来源；npm 还会检查已装版本是否符合声明。恢复预览与执行确认必须发生在加载新设置之前。[resource-loader.js:356](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js:356)、[package-manager.js:1000](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js:1000)

## 6. 还原后何时生效

- 官方 `/reload` 的明确范围是快捷键、扩展、Skills、模板、主题和上下文文件；扩展 reload 会替换运行时，旧命令在 `await ctx.reload()` 之后不能继续使用旧会话状态。[slash-commands.md:49](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/slash-commands.md:49)、[extensions.md:50](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:50)
- 当前会话 reload 会重新读取 settings 和资源，但对 `defaultTools` 只激活新增工具；从配置移除的工具不会被立即禁用。不能把 reload 当作当前进程完全切换到快照的保证。[agent-session.js:2998](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2998)、[settings.md:58](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:58)
- 官方说明打开 `/model` 会重新读取 `models.json`，扩展也可以等待 `ctx.modelRegistry.refresh()` 完成后读取模型注册表；核心 `session.reload()` 没有直接调用模型配置刷新。首版可以选择统一提示重启，以减少即时应用的状态承诺。[models.md:67](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:67)、[model-registry.d.ts:24](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:24)、[agent-session.js:2998](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2998)

## 7. 0.84.3 基线对照

以下为同轮官方旧版文档核对结果；只覆盖列出的行为，不构成完整兼容性验证。

- 两版都支持 `$ENV` / `${ENV}` 插值；裸 `NAME` 是字面值。两版都存在无鉴权端点依赖 dummy API key 的情况，不能把所有字面 `apiKey` 自动判定为秘密删除。[v0.84.3 models.md:149](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/models.md#L149)、[v0.84.3 models.md:37](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/models.md#L37)
- 旧版也区分模型已加载与模型有可用鉴权；鉴权缺失不应被报告为配置丢失。[v0.84.3 models.md:138](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/models.md#L138)
- 0.84.3 文档说明项目数组替换全局数组；1.4.0 的 `defaultTools` 已有 `+/-` 继承规则，不能将新版设置语义直接套到旧版。[v0.84.3 settings.md:221](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/settings.md#L221)、[1.4.0 settings.md:48](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:48)
- 旧版列出的 `trust.json` 属于本机项目授权状态，应保持本机独有。[v0.84.3 settings.md:14](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/settings.md#L14)
- npm/Git 来源、版本固定与本地路径规则在两版中均有依据；包更新使用 `pi update --extensions`，普通 `pi update` 会更新 Pi 本体，恢复过程不能误用。[v0.84.3 packages.md:23](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/packages.md#L23)、[v0.84.3 packages.md:63](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/packages.md#L63)、[v0.84.3 packages.md:90](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/packages.md#L90)
- 旧版 MCP 文档地址返回 404、旧版 models-store 源码抓取发生 SSL 失败。这些结果不足以证明功能不存在；旧版这两项行为仍待验证。

## 8. P0 决策候选（待采访确认）

1. **还原语义**：还原为快照管理范围内的精确状态，还是只新增/更新并保留目标机器多出的项？此决定控制删除、配置优先级、备份及失败恢复。
2. **范围语义**：仅 agent 内的全局可移植内容，还是追踪其外部依赖？严格 agent 范围下，外部本地路径和 `~/.agents/skills` 应报告未覆盖，不能悄悄把内容复制进来。
3. **可重复性承诺**：保持原扩展来源声明，还是固定当前已安装的 npm 版本/Git commit？以及 Pi 本体版本不一致时阻止、警告还是允许。
4. **资源与秘密边界**：MCP、全局指令、Skills 和扩展自定义配置是否纳入首版？任意脚本/Markdown 可以嵌入秘密，通用扫描无法证明绝不包含凭据；需要明确受支持配置与用户选定源码的责任边界。
5. **本机鉴权保留**：同 Provider ID、不同 endpoint 的快照是否仍可自动沿用本机 Key？可能把原凭据发往新地址，应明确要求重新确认或重新鉴权。
6. **成功定义与部分失败**：恢复配置后允许缺凭据待用户处理；扩展下载失败、依赖不兼容或需要重启时，能否报告“配置已写入”而不报告“环境已可用”。

这些是设计问题，不是已经存在的同步能力。没有实施删除、同步、还原、安装、Git 远端写入或跨系统验证。

## 9. 后续决定与运行依赖检查

- P0 已在后续采访中逐项回答，当前完整要求见 [Pi Sync 规格](../../.scratch/pi-sync/spec.md)；第 8 节保留为研究当时的问题清单，最终选择以规格为准。
- 官方 npm 安装方式要求 Node.js 22.19 或以上，但独立安装与其他包管理路径不能据此统一判定必须有系统 Node。用户可以通过 `npmCommand` 配置命令和参数，源码明确识别 npm、pnpm、Bun；预检应针对实际调用计划验证可执行命令和版本。[quickstart.md:15](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/quickstart.md:15)、[settings.md:144](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:144)、[package-manager.js:1455](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js:1455)

## 10. 实施与验证

七张任务已经完成，实际复用了 Pi 的公开包位置查询与安装入口，以及现有命令级测试方式。保存采用 bare Git 对象与正常推送，资源与事务备份保存在本机受管根内。Windows 与 WSL Ubuntu 的 check/test、Windows 独立 smoke 和真实 TUI 已执行；macOS 无可用环境，按用户确认标记未实测。版本与故障验证的详细范围以 [验证记录](../../.scratch/pi-sync/verification.md) 为准。
