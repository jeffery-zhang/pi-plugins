# Pi Purge

独立的 Pi 提示词扩展。安装包自带已验证的提示词，不需要安装 DSH、准备外部提示文件或从其他项目下载资源。

运行时使用 Node 标准库和 Pi 提供的扩展 API。保留原生工具、工程规则、AGENTS、skills 和工作目录，不设置模型/provider 白名单。当前宿主验证版本为 **Pi 1.4.0**，行为必验模型为 DeepSeek V4.1 Flash。

## 安装和使用

发布到 npm 后可安装：

```sh
pi install npm:@jingoz/pi-purge
```

当前仓库可直接临时加载或登记本地目录：

```sh
pi -e ./packages/pi-purge
pi install ./packages/pi-purge
```

重新启动 Pi 后默认启用：

- `/purge` 或 `/purge status`：查看包内提示词摘要、启用意图和最近一次请求观察。
- `/purge on`：启用并检查包内提示词，下一轮再次读取。
- `/purge off`：仅在当前会话停用，后续请求恢复正常 Pi 提示。

同一会话切换模型沿用开关，新会话恢复启用；请在当前轮结束后启停。状态查询不会修改开关或触发模型请求。

内置正文位于 `prompts/default.md`，跟随包版本分发。运行时按模块位置定位该文件，与当前工作目录和用户主目录无关，不读取其他应用的配置或提示词。Pi 自身的模型配置、凭据及项目上下文仍由宿主管理。

包内文件缺失、损坏或无法解码时，明确报告未生效，本轮恢复正常 Pi 提示；不会自动转向外部目录或静默沿用旧正文。重新安装完整包即可恢复资源。插件不清理已有对话历史，停用不会撤销已有回复。

## 观测与隐私

`prepared` 表示正文已读取；`applied` 表示请求投影已应用。`request.bodyPresent: true` 表示客户端观察点发现完整目标正文，不能代替行为生效验收。

状态分别报告资源原始字节、规范化正文和请求指令的摘要。请求指令包含工程段，因此三个 hash 可能不同。未知或未观测的信息显示为 `null`。

TUI 使用状态栏和命令通知，无 UI 模式写入 stderr，不污染 stdout 协议。默认不写日志文件，不打印提示正文、用户正文、工具参数/结果、headers 或凭据。

只观察 provider 请求，不重写 API 或自动重试。其他扩展可能继续改变请求；观察点不等于网关最终处理。遇到无法保留结构的完整 system override 时明确回退。

## 实现与兼容

通过 `before_agent_start` 准备内置正文，再使用公开 `context_with_system` 替换请求投影中的身份段；工具、工程段和会话历史保留。具体工程约束优先于冲突的角色指令。

正文仅整理 UTF-8、BOM、CRLF、ChatML 行布局及缺失的 project 标签闭合。原有已验收正文按字节随包提供，没有加入模板引擎、提示词库、外部下载或文件监听器。

当前仅允许已验证的 Pi 1.4.0；其他宿主版本明确不启用。其他模型可使用同一组装，但实际效果尚未验证。

## 开发和发布检查

开发依赖仅用于检查，运行包不携带 Pi SDK 副本。若需要下载依赖，使用国内镜像：

```sh
pnpm --filter @jingoz/pi-purge install --registry https://registry.npmmirror.com
pnpm --filter @jingoz/pi-purge check
pnpm --filter @jingoz/pi-purge test
```

测试包含公开扩展场景与真实 Pi SDK/CLI 宿主契约，使用本机模拟服务，不消耗模型额度；独立分发场景只复制发布清单中的文件，在全新主目录及仓库外带空格路径运行。开发机需有 Pi 1.4.0 CLI。

可选真实模型冒烟会使用 Pi 已配置的 DS 凭据并消耗额度：

```sh
pnpm --filter @jingoz/pi-purge smoke
```

发布前执行 `prepublishOnly` 的检查和测试。当前版本为 `0.1.0`，已准备发布元数据、明确的文件清单和授权说明；本次未执行实际 npm 发布。

## 来源与授权

扩展代码采用 [MIT License](./LICENSE)。内置提示词沿用已验收的改编稿，基础来自 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)，镜像为 [mmparko/dsh-purge](https://github.com/mmparko/dsh-purge)。这是内容来源和署名，插件不在运行时加载其代码或资源。

上游 MIT 文本、镜像说明，以及 README 对署名和非营利分发的额外说明均保留在 [第三方说明](./THIRD_PARTY_NOTICES.md) 和 `third-party/` 中。内置提示词不宣称为本插件原创，也不宣称可不受限制地商业转售。
