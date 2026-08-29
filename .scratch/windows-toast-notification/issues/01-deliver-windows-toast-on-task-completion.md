# 01: Deliver Windows Toast on task completion

**What to build:** Add a lightweight Windows-only Pi TUI extension that emits one system Toast after each settled task. The notification identifies Pi, includes only the current directory name, remains isolated across Pi processes, and never falls back to another notification mechanism.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

Spec: [Windows Toast Task Completion Notification](../spec.md)

- [ ] A standard private ESM Pi package loads through its explicit extension entry without third-party runtime dependencies.
- [ ] Each Windows TUI `agent_settled` event requests exactly one Toast displaying `Pi` and `Task completed · <当前目录名>`.
- [ ] Multiple Pi processes operate independently and no cross-process coordination, deduplication or shared state is introduced.
- [ ] Prompts, responses, session names, full paths, process IDs, timestamps and other details never enter the notification.
- [ ] Non-Windows platforms and `rpc`, `json` and `print` modes remain inert.
- [ ] Toast failures do not affect Pi and do not trigger OSC, bell, taskbar, TUI or executable fallback behavior.
- [ ] Automated scenarios cover the Windows TUI happy path, mode/platform isolation, safe project-name handling and failure containment at the extension event boundary.
- [ ] Package and root documentation describe the fixed Windows-only behavior and its multi-process limitation.
- [ ] Package `check` and `test`, package loading, frozen lockfile validation and `git diff --check` pass.
- [ ] A real Windows TUI smoke visually confirms the fixed Toast presentation without installing the package.
