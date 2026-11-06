# Model Detect 验证记录

日期：2026-11-06（Asia/Shanghai）。实际宿主：Windows / PowerShell 7 / Node.js 24.12.0 / Pi 1.4.0。最低兼容目标为 Pi 1.4，未来版本、WSL/macOS 未实测。

## 已执行的检查

- `pnpm --filter @jingoz/pi-model-detect check`：通过。
- `pnpm --filter @jingoz/pi-model-detect test`：47/47 通过，使用真实 Pi 会话命令边界、临时 Agent Directory 和本地 HTTP。
- `pnpm --filter @jingoz/pi-model-detect smoke`：通过，真实 Pi CLI 以 `-e` 加载本包，在 RPC 模式访问公开 models.dev。取消的单模型不写入；随后一次确认更新两个目标并保存各自来源；无 agent_start/model 请求。
- 真实 ConPTY TUI 冒烟：以 `pi -e` 临时加载本包；手工输入原厂来源，Esc 取消后磁盘未变化；provider 批量输入两个来源，浏览长预览并确认，核验两个模型和来源映射均已保存；显式附来源参数替换已保存映射并再次确认，磁盘值正确。
- 修复后再次启动真实 TUI，已观察到 overlay 中完整的分行差异、行号、滚动/确认/取消提示及成功后的“请重启 Pi 生效”。当前会话 footer 仍显示旧 400k，新磁盘参数为 128k，证明没有热切换当前模型。
- 所有冒烟仅使用临时模型连接与假凭据；未安装扩展到真实 Pi，未修改真实模型配置，未发送模型推理请求。

## 任务验收证据

| 任务 | 关键行为 | 权威证据 |
|---|---|---|
| 01 单模型 | 正整数限制、文字/图片、JSONC/BOM/CRLF、备份原字节、取消、无 UI、未知目标、并发改动、网络失败及回退 | `single command updates real Pi metadata…`、`user cancellation…`、`network status…`、`concurrent file changes…`、`publication failure…`；实际 RPC/TUI 冒烟 |
| 02 来源映射 | 自定义目标不改 ID；名称歧义选择；持久化/复用/失效；显式替换；来源优先；按目标隔离 | `custom IDs…`、`manual lookup cancellation…`、`explicit source text…`、`saved source outranks…`、`TUI ambiguous names…`；RPC 两目标映射、TUI 手工输入与替换 |
| 03 思考/价格 | 完整 null/none/extended effort；预算/开关/未知整组保留；零价不同于未知；缓存缺项保留；272000 阈值；阶梯缺项整组保留 | `budget, toggle…`、`reasoning false…`、`zero and invalid limits…`、`complete tiers…`、`saved source outranks…`；每项由真实 Pi ModelRuntime 重新读取断言 |
| 04 provider | 显式集合去重；不导入目录模型；保留其他 provider；ID 含斜杠；未知覆盖跳过；无变化不再确认；一次请求和一次确认 | `provider batch deduplicates…`、`built-in single target…`、`single command…is repeatable`；实际 CLI RPC、真实 TUI provider 流程 |

## 需求逐项审计

| 需求/不变量 | 实现与验证 |
|---|---|
| 仅斜杠命令，Pi 1.4+ 包结构 | 包声明为 private ESM、显式扩展入口；factory 注册 detect 与 shutdown，无 CLI flag/tool；实际 Pi 1.4.0 加载通过 |
| 单项已有模型、批量显式已有模型 | 使用 registry 识别目标，批量来自显式 models/overrides 并去重；真实宿主覆盖内置单项、空批量、未知覆盖与嵌套 ID |
| 公共目录一次获取、结构和数值校验 | 命令只调用一次目录读取；请求超时/取消/20 MiB 上限；HTTP、JSON、类型、有限价格、正整数限制均校验 |
| 可指定目录名称/ID，唯一来源 | 精确来源优先；输入查询后有歧义必选唯一条目；TUI 选择器最多显示八行并可滚动，RPC 用原生 select |
| 来源持久化、复用、可替换 | 插件自有配置按目标保存；来源作为统一元数据依据；失效需重新指定；显式来源可替换既有关系 |
| 原厂价与能力来自同一条目 | 通过显式选原厂目录条目实现；不独立猜测价格来源；预览展示目标与源，并说明 USD/百万 tokens |
| 有效覆盖、未知保留、分组策略 | 元数据仅允许基础限制/输入/思考/价格；按已确认 Q3/Q5/Q9 处理；宿主重新加载验证有效值与保留值 |
| 统一差异与一次确认 | 整批先计算再确认；TUI 可滚动 overlay、RPC confirm；取消不保存模型或映射 |
| 保留连接/鉴权/名称/采样/无关配置 | 写入 modelOverrides 的受控叶字段，原模型定义保留；测试断言假密钥、显示名称、其他 provider 不变，输出无凭据标记 |
| 备份、并发检测、发布回退 | 确认后备份原字节，临时文件同步后原子替换；同环境排他锁与原字节并发检测；第二个文件发布失败时回退第一个 |
| 无 UI/取消/停机/重复调用 | print/JSON 拒绝写入；Esc 取消查询/确认；shutdown abort 并等待操作结束；重复命令拒绝；临时文件与锁释放均已断言 |
| 重启生效、无模型请求 | 实现不调用 setModel/registry.refresh，不自动退出；宿主保持原模型对象；真实 TUI 原参数 footer 与新磁盘参数对照，RPC 模型请求数为 0 |
| 每插件 check/test、实际冒烟 | 本插件三条已声明脚本均执行通过，实际 TUI/RPC 流程完成 |

## 已知边界

- models.dev 是目录声明，不是端点能力实测或实际账单。预算型思考与不完整阶梯按规格保留，不近似转换。
- 模型文件和映射文件分别原子发布，普通失败会回退；异常断电/强制结束进程不具备跨文件事务保证。备份和遗留锁处理已写入 README；并发外部编辑采用发布前检测，不承诺与任意外部编辑器互斥。
- 符号链接/硬链接配置拒绝更新；原配置不是 UTF-8、JSON 结构有误或重复键时拒绝更新，保留原文件。
- 未进行真实账户收费验证、其他平台与未来 Pi 版本测试；未提交或推送。
