## Agent skills

### Issue 跟踪

Issue 以本地 Markdown 文件记录在 `.scratch/` 下。详见 `docs/agents/issue-tracker.md`。

### 分诊标签

使用五个默认标准分诊标签。详见 `docs/agents/triage-labels.md`。

### 领域文档

使用单上下文领域文档布局。详见 `docs/agents/domain.md`。

## Pi 插件开发

开发或修改 `packages/*` 下的插件前，先阅读 `docs/research/pi-plugin-development.md`。当前兼容基线是 `@earendil-works/pi-coding-agent@0.84.2`；统一从 `@earendil-works/*` 导入，升级基线必须单独验证并更新研究文档。

### 包结构

- 每个插件独立放在 `packages/<kebab-case-name>/`，至少包含 `package.json` 和 `src/index.ts`。
- `package.json` 使用 `type: "module"`、`private: true` 和显式的 `pi.extensions: ["./src/index.ts"]`；仅在准备发布时添加版本与发布元数据，并移除 `private: true`。
- 实际导入的 Pi 自带包和 `typebox` 放入 `peerDependencies`，版本为 `"*"`；第三方运行时依赖放入 `dependencies`，开发工具放入 `devDependencies`。
- 优先复用 Pi API、Node.js 标准库和仓库已有代码；一个实现不增加额外抽象层。

### 入口与行为

- `src/index.ts` 默认导出接收 `ExtensionAPI` 的同步或异步 factory。用户显式动作使用 `registerCommand`，模型能力使用 `registerTool`，生命周期和拦截逻辑使用 `pi.on`。
- Factory 只做注册和一次性初始化。进程、socket、watcher、timer 等资源在 `session_start` 或首次使用时启动，并由幂等的 `session_shutdown` 完整释放。
- 工具参数使用 TypeBox 严格定义并校验；异步 I/O 传递 `AbortSignal`；执行失败直接 `throw`。大输出使用 Pi 的截断工具，并明确告知截断及完整输出位置。
- 对话框和通知先检查 `ctx.hasUI`；TUI 组件、`custom()` 和终端输入先检查 `ctx.mode === "tui"`。插件拥有用户的完整系统权限，破坏性操作必须确认，日志不得泄露密钥或敏感内容。

### 完成标准

- 运行该插件已声明的 `check`/`test`；非平凡逻辑至少保留一个可运行的最小检查。
- 使用 `pi -e ./packages/<plugin-name>` 做本地冒烟验证，实际触发新增的 command、tool 或 event；涉及取消、无 UI、错误或长期资源时，同时验证对应路径。
- 只有用户明确要求安装时才运行 `pi install`；项目级安装使用 `-l`。
