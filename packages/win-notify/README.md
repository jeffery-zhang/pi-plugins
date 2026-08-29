# @jingoz/pi-win-notify

A Windows-only Pi TUI extension that sends one Windows Toast when Pi has fully settled and is ready for input.

## Behavior

- Listens to Pi's `agent_settled` event, so automatic retries, compaction retries, and queued continuations do not cause premature notifications.
- Only works on Windows (`process.platform === "win32"`) and in TUI mode. RPC, JSON, print, Linux, and macOS stay inert.
- Displays exactly:

```text
Pi
Task completed · <current directory basename>
```

- Uses `powershell.exe` to call the Windows Runtime Toast API. No third-party runtime dependency or resident helper is used.
- Each Pi process sends its own Toast on each settled task. There is no duration threshold, focus detection, deduplication, or cross-process state.
- Prompts, responses, session names, full paths, process IDs, timestamps, images, buttons, and notification actions are never included.
- Sound, display duration, suppression, grouping, and notification-center retention follow Windows settings.
- Toast failures are contained and never affect Pi or fall back to another notification mechanism.

## Local Development

```bash
pnpm --filter @jingoz/pi-win-notify check
pnpm --filter @jingoz/pi-win-notify test
pnpm install --frozen-lockfile --offline
pi --no-extensions -e ./packages/win-notify --list-models
```

Automated tests cover the Windows TUI happy path, exact Toast content, one notification per settlement, platform/mode isolation, PowerShell-sensitive directory basenames, and failure containment.

A real visual Windows TUI smoke remains manual verification: load the package in a Windows TUI Pi session, complete one agent run, and confirm the system Toast appears.
