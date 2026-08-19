# Issue 跟踪：本地 Markdown

本仓库的 Issue 和规格文档以 Markdown 文件形式存放在 `.scratch/` 中。

## 约定

- 每个功能使用一个目录：`.scratch/<feature-slug>/`
- 规格文档位于 `.scratch/<feature-slug>/spec.md`
- 每个实现任务单独存放在 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号，不使用合并的任务文件
- 分诊状态记录在每个 Issue 文件顶部附近的 `Status:` 行中（角色字符串见 `triage-labels.md`）
- 评论和对话历史追加到文件末尾的 `## Comments` 标题下

## 当 skill 要求“发布到 Issue 跟踪器”时

在 `.scratch/<feature-slug>/` 下创建新文件；目录不存在时一并创建。

## 当 skill 要求“获取相关任务”时

读取所引用路径中的文件。用户通常会直接提供路径或 Issue 编号。

## 寻路操作

供 `/wayfinder` 使用。**地图**是主文件，每个任务对应一个**子任务**文件。

- **地图**：`.scratch/<effort>/map.md`，正文包含 Notes、Decisions-so-far 和 Fog。
- **子任务**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文中写明问题。`Type:` 行记录任务类型（`research`/`prototype`/`grilling`/`task`），`Status:` 行记录 `claimed`/`resolved`。
- **阻塞**：文件顶部附近使用 `Blocked by: NN, NN`。列出的所有任务均为 `resolved` 后，当前任务解除阻塞。
- **前沿任务**：扫描 `.scratch/<effort>/issues/`，查找开放、未阻塞且无人认领的文件，编号最小者优先。
- **认领**：开始工作前设置 `Status: claimed` 并保存。
- **解决**：在 `## Answer` 标题下追加答案，将状态设为 `Status: resolved`，再把上下文指针（摘要和链接）追加到 `map.md` 的 Decisions-so-far 中。
