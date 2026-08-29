# 01: Deliver Windows Toast on task completion

**What to build:** Add a lightweight Windows-only Pi TUI extension that emits one system Toast after each settled task. The notification identifies Pi, includes only the current directory name, remains isolated across Pi processes, and never falls back to another notification mechanism.

**Blocked by:** None (can start immediately).

**Status:** resolved

Spec: [Windows Toast Task Completion Notification](../spec.md)

- [x] The ESM package is named `@jingoz/pi-win-notify` and loads through its explicit extension entry without third-party runtime dependencies.
- [x] Each Windows TUI `agent_settled` event requests exactly one Toast displaying `Pi` and `Task completed · <当前目录名>`.
- [x] Multiple Pi processes operate independently and no cross-process coordination, deduplication or shared state is introduced.
- [x] Prompts, responses, session names, full paths, process IDs, timestamps and other details never enter the notification.
- [x] Non-Windows platforms and `rpc`, `json` and `print` modes remain inert.
- [x] Toast failures do not affect Pi and do not trigger OSC, bell, taskbar, TUI or executable fallback behavior.
- [x] Automated scenarios cover the Windows TUI happy path, mode/platform isolation, safe project-name handling and failure containment at the extension event boundary.
- [x] Package and root documentation describe the fixed Windows-only behavior and its multi-process limitation.
- [x] Package `check` and `test`, package loading, frozen lockfile validation and `git diff --check` pass.
- [x] A real Windows TUI smoke visually confirms the fixed Toast presentation without installing the package.

## Answer

Implemented `@jingoz/pi-win-notify` as an ESM Pi package with one `agent_settled` handler. Windows TUI sessions invoke the Windows Runtime Toast API through `powershell.exe`; other platforms and modes remain inert. The application identity is fixed to `Pi`, and the single text payload is `Task completed · <current directory basename>`. UTF-8 Base64 transport keeps PowerShell-sensitive directory names out of the generated script syntax. Failures are contained without another notification path.

Validation passed:

- `corepack pnpm --filter @jingoz/pi-win-notify check`
- `corepack pnpm --filter @jingoz/pi-win-notify test` (5/5)
- `corepack pnpm install --frozen-lockfile --offline`
- `pi --no-extensions -e ./packages/win-notify --list-models`
- `git diff --check`
- Strict Windows Runtime smoke with PowerShell errors promoted to terminating errors (exit 0)
- Windows notification history returned the active `Pi` Toast after the smoke

No package installation or fallback notification mechanism was added.

## Comments

- Follow-up publication preparation set the first release to `0.1.0`, added npm package metadata and removed `private` after the user initiated publishing.
