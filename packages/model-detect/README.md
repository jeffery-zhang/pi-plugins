# Model Detect

Pi 1.4+ 扩展：从 [models.dev](https://models.dev/) 补全已有模型的上下文、最大输出、文字/图片输入、明确的思考档位和 token 价格。已验证 Windows / Pi 1.4.0。

## 使用

先临时加载扩展（从仓库根目录执行）：

```powershell
pi -e ./packages/model-detect
```

在 Pi 内输入：

```text
/detect openai/gpt-5
/detect openai
/detect myproxy/custom-id openai/gpt-5
```

- 单模型模式可指定 Pi 已识别的模型，ID 内的 `/` 会保留。
- 仅传 provider 时，只取其显式模型和指向已有模型的覆盖条目，不导入目录模型。仅配置了认证而未显式列模型时，批量目标为空。
- 可在目标后附来源名称或完整 `provider/model`，覆盖已保存的对应关系；名称含空格时直接输入剩余文字即可。没有精确匹配时也会提示输入来源，有多个候选则选择唯一条目。
- 来源映射按目标保存，下次自动复用。能力、限制和价格均来自同一个条目；要按原厂价估算，请选择原厂 provider。
- TUI 预览可用 ↑↓、PgUp/PgDn、Home/End 滚动，Enter 一次确认本次全部差异，Esc 取消。查询期间 Esc/Ctrl+C 也可取消。
- RPC 客户端须支持 Pi 的 input/select/confirm UI 协议。print/JSON 模式没有确认 UI，命令会拒绝写入。
- 仅在模型空闲且没有排队消息时运行；同一 Agent Environment 同时只允许一次 detect。

## 更新规则

有效目录值覆盖旧元数据；无效或缺失字段保留并说明。输出 token 与上下文分别处理，音频、视频、PDF 等模态不写成 Pi 的文字/图片能力。

有明确 effort 时更新完整思考档位映射；只有预算、开关或未知档位时保留整个本地思考组。价格按 USD/百万 tokens 写入，未知缓存价格不填零；阶梯无法完整转换，或缺少能取代既有阶梯的明确数据时，保留整个价格组。目录中的原厂标价用于估算，不代表代理实际账单。

写入前统一预览，确认后备份，再修改 Pi 的 `modelOverrides`，保留原有模型定义、连接、鉴权、显示名称、兼容设置、采样参数、注释、BOM 和换行。不会发送模型请求。

**完成后请重启 Pi 生效。** 本扩展不刷新或切换当前会话模型，不自动退出 Pi。

## 数据与恢复

位置基于 Pi 的 Agent Directory（默认 `~/.pi/agent`，支持 `PI_CODING_AGENT_DIR`）：

- `models.json`：Pi 模型配置。
- `model-detect.json`：插件自己的 `sources` 来源映射；键是本地 `provider/model`，值是目录 `provider/model`。
- `model-detect/backups/<时间-随机标识>/`：本次发生变化文件的原始字节备份；不存在的原文件没有对应备份。
- `model-detect.lock`：运行期间的排他锁。正常取消和关闭会清理；进程异常终止后，先确认其他 detect 已结束，再手动移除遗留锁。

保存前检测并发修改；正常文件发布失败会回退已发布内容。备份保留原鉴权数据，请与 Pi 配置一样妥善保管。异常断电/强制终止无法保证两个文件同时完成发布；重新运行前可对照备份检查模型与映射，避免覆盖他人的后续改动。配置为符号链接或硬链接时会拒绝写入。

## 开发验证

```powershell
pnpm --filter @pi-plugins/model-detect check
pnpm --filter @pi-plugins/model-detect test
pnpm --filter @pi-plugins/model-detect smoke
```

`test` 使用本地 HTTP、隔离的 Pi 会话和临时文件，不读真实用户配置。`smoke` 通过真实 Pi CLI 的 `-e` 加载包，在 RPC 模式访问公开 models.dev，验证来源输入、取消、批量确认及保存；需要可访问目录的网络，不调用模型。
