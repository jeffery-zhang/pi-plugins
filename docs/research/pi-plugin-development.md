# Pi 插件开发规范摘要

## 基线

- 本机使用 `@earendil-works/pi-coding-agent@0.84.3`，npm 元数据指向 [`earendil-works/pi`](https://github.com/earendil-works/pi/tree/v0.84.3/packages/coding-agent)。本文以该版本随包的 [`extensions.md`](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/extensions.md) 和 [`packages.md`](https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/packages.md) 为准。
- 0.84.3 在 0.84.2 基础上新增 `session_compact_failed` 扩展事件，Image Input 以此可靠处理 compaction 失败/取消，不再使用 0.84.2 间接状态推断。
- 旧包 `@mariozechner/pi-coding-agent` 已弃用；新代码统一从 `@earendil-works/*` 导入。参见[当前 npm 包](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)与[旧 npm 包](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)。

## Pi 的强制约束

1. 扩展入口必须默认导出 factory；同步或异步均可，异步 factory 会在 `session_start` 和 `resources_discover` 前被等待。TypeScript 由 jiti 直接加载，无需预编译。

   ```ts
   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

   export default function (pi: ExtensionAPI) {
     // 在这里注册事件、命令和工具
   }
   ```

2. factory 只做注册和一次性初始化，不在其中启动进程、socket、watcher 或 timer。会长期占用资源的工作在 `session_start` 或首次使用时启动，并用幂等的 `session_shutdown` 关闭；reload/new/resume/fork 都会替换扩展实例。详见[生命周期说明](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/extensions.md#long-lived-resources-and-shutdown)。
3. 工具通过 `registerTool` 注册，至少提供 `name`、`label`、`description`、TypeBox `parameters` 和 `execute`。`execute` 必须尊重传入的 `AbortSignal`；失败应 `throw`，Pi 会转成 `isError: true` 的工具结果。不要把失败伪装成普通文本结果。参见[工具文档](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/extensions.md#custom-tools)和[最小示例](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/examples/extensions/hello.ts)。
4. 工具大输出使用官方 `truncateHead`/`truncateTail`，默认上限为 50 KB 或 2000 行；截断时必须告诉模型已截断，并给出完整输出的位置。读取/搜索保留头部，日志/命令输出保留尾部。参见[截断规范](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/extensions.md#tool-output-truncation)。
5. UI 必须按模式守卫：对 TUI/RPC 都可用的对话框和通知先检查 `ctx.hasUI`；`custom()`、组件和终端输入等仅 TUI 能力先检查 `ctx.mode === "tui"`。JSON/print 模式不能交互。可取消的 UI 或异步工作传递 `AbortSignal`。参见[模式行为](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/extensions.md#mode-behavior)。
6. 发布或通过 `pi install` 安装后需要的第三方包放在 `dependencies`，不能只放 `devDependencies`。Pi 自带的 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui` 和 `typebox` 放在 `peerDependencies`，版本写 `"*"`，且不要打包进去。参见[依赖规范](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/packages.md#dependencies)。
7. 扩展拥有当前用户的完整系统权限。只安装可信来源，项目级扩展须在项目被信任后加载。

## 本仓库约定

每个插件放在 `packages/<plugin-name>/`，使用显式入口，避免依赖隐式扫描：

```text
packages/<plugin-name>/
├── package.json
└── src/index.ts
```

```json
{
  "name": "@pi-plugins/<plugin-name>",
  "private": true,
  "type": "module",
  "pi": { "extensions": ["./src/index.ts"] },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

- `pi.extensions` 在使用官方约定的 `extensions/` 目录时不是强制字段；本仓库使用 `src/index.ts`，因此必须显式声明。`name`、`private`、`type` 属于本仓库统一约定，不是 Pi 运行时额外要求。
- 只有发布到 npm/GitHub Gallery 时才添加 `version`、发布元数据和 `keywords: ["pi-package"]`；`pi-package` 只影响可发现性，不影响加载。
- 用户显式动作使用 `registerCommand`；供模型调用的能力使用 `registerTool`；生命周期或拦截逻辑使用 `pi.on`。不为一个实现增加额外抽象层。
- 内存状态会随 reload 或 session replacement 丢失；需要持久化时使用 Pi session entry，并从当前分支重建状态。

## 发现、安装与验证

- 快速验证单个入口：`pi -e ./packages/<plugin-name>/src/index.ts`。
- 按 package 规则临时验证：`pi -e ./packages/<plugin-name>`。
- 本地安装：`pi install ./packages/<plugin-name>`；项目级安装加 `-l`，写入 `.pi/settings.json`。本地路径只登记引用，不复制文件。参见[安装与本地路径规则](https://github.com/earendil-works/pi/blob/914cf1472e715297caa30db4b9535d534a9eb718/packages/coding-agent/docs/packages.md#install-and-manage)。
- 自动发现仅扫描 `~/.pi/agent/extensions/` 和受信任项目的 `.pi/extensions/` 中的单文件或 `*/index.ts`；只有自动发现位置支持 `/reload`。开发时至少实际触发新增 command/tool/event，并验证取消、错误、无 UI 模式及 `session_shutdown` 清理路径。

Pi 没有规定测试框架、lint 或 tsconfig；后续新增脚本属于本仓库规范，应保持每个插件最小且可独立运行。
