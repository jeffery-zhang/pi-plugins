# Windows Toast Task Completion Notification

Status: ready-for-agent

## Problem Statement

Pi 用户可能同时在多个终端中运行长任务。任务完成时，如果用户正在查看其他窗口，就容易错过 Pi 已经等待输入的状态。用户需要一个简单的 Windows 系统提示，同时不希望扩展引入任务栏集成、跨平台协议、复杂配置或对话内容提取。

## Solution

提供一个仅面向 Windows Pi TUI 的轻量扩展。每当一个 Pi 进程进入稳定的任务完成状态时，扩展发送一条 Windows Toast：应用名固定显示为 `Pi`，正文固定为 `Task completed · <当前目录名>`。

每个 Pi 进程独立发送通知。多个进程完成时会产生多条 Toast，Windows 可以按系统行为展示或分组；当前目录名用于区分大多数并行项目。扩展不读取对话内容，不添加其他详情，不管理通知中心中的留存，也不提供其他通知方式作为 fallback。

## User Stories

1. As a Windows Pi TUI user, I want a Toast when Pi has completely settled, so that I know the task is ready for my attention.
2. As a user running multiple Pi processes, I want the current directory name in each Toast, so that I can usually identify which project completed.
3. As a privacy-conscious user, I want notifications to omit prompts and assistant responses, so that conversation content is not exposed on screen.
4. As a user who relies on Windows notification preferences, I want sound, display duration, grouping and notification-center retention left to Windows, so that the extension respects my system settings.
5. As a Pi user, I want notification failures to leave the completed task unaffected, so that an unavailable Toast mechanism cannot disrupt the session.
6. As a maintainer, I want one Windows-only notification path with no protocol fallback or configuration surface, so that the extension remains lightweight and predictable.

## Implementation Decisions

- The feature is an independent publishable ESM Pi package named `@jingoz/pi-win-notify`, with an explicit extension entry and Pi's coding-agent package as a peer dependency.
- The extension listens to `agent_settled`, not `agent_end`, because Pi may still retry, compact or deliver queued continuations after a low-level agent run ends.
- Notifications are emitted only when `process.platform` is `win32` and the extension context mode is `tui`.
- Each `agent_settled` event emits one Toast. There is no duration threshold, focus detection, debounce or cross-process coordination.
- The Toast application name is exactly `Pi`.
- The Toast body is exactly `Task completed · <当前目录名>`, where the suffix is derived from the basename of the current extension context working directory.
- No prompt, assistant response, session name, full path, process ID, timestamp, image, button or other detail is included.
- Windows PowerShell invokes the Windows Runtime Toast API. No third-party runtime dependency, resident helper process, socket, watcher or timer is introduced.
- Multiple Pi processes remain independent. Concurrent completions can create multiple notifications; Windows owns their ordering and grouping.
- Notification sound, visibility duration, suppression and notification-center retention follow Windows settings.
- A Toast execution failure is contained by the extension and does not affect Pi's completed run. The extension does not fall back to OSC, terminal bell, taskbar progress, in-TUI notification or another executable.
- Non-Windows and non-TUI modes remain inert.
- The package README and root package list document the Windows-only behavior and fixed notification content.
- No context-specific domain glossary or ADR is required because the package introduces no shared domain state or architectural contract.

## Testing Decisions

- The primary automated seam is a package-level extension event harness. It invokes the registered `agent_settled` handler and observes the external command request instead of testing private helper structure.
- The happy path proves that one Windows TUI settlement requests exactly one Toast with application name `Pi` and body `Task completed · <当前目录名>`.
- Isolation scenarios prove that non-Windows platforms and Pi `rpc`, `json` and `print` modes request no notification.
- Failure coverage proves that a rejected or unsuccessful Toast command does not escape the event handler and does not trigger a fallback command.
- A project-name scenario covers a working directory containing PowerShell-sensitive characters, proving that display text is passed safely without changing the required visible content.
- A real Windows TUI smoke loads the package with `pi -e`, completes one agent run and visually confirms the two-line Toast presentation.
- Package `check` and `test`, package loading, frozen lockfile validation and `git diff --check` must pass. Installation is not performed unless separately requested.

## Out of Scope

- Taskbar overlay icons, blue dots, badges, progress bars or window flashing.
- Toast support on macOS, Linux, WSL or remote hosts.
- OSC 99, OSC 777, terminal bell, native terminal notifications or TUI notifications.
- Detecting whether Windows Terminal is focused, minimized or visible.
- Minimum task duration, notification throttling, deduplication or cross-process coordination.
- User-configurable titles, body templates, thresholds, sounds or enablement rules.
- Prompt excerpts, final-answer summaries, session names, full paths, process IDs or timestamps.
- Toast actions, buttons, images, click handling or deep links.
- Programmatically clearing or managing notifications in Windows Notification Center.
- Installing the package.

## Further Notes

- Pi's bundled notification example establishes `agent_settled` as the completion event and demonstrates Windows Runtime Toast invocation through PowerShell.
- Windows may group multiple notifications under the same application identity. The project directory basename is the only source detail included by design.
- This specification deliberately accepts that two Pi processes in the same directory produce indistinguishable Toasts.
