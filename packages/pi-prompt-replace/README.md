# @jingoz/pi-prompt-replace

A model-scoped Pi extension for upstreams that identify and reject Pi requests from the default system prompt.

## Install

```bash
pi install npm:@jingoz/pi-prompt-replace
```

The package supports Pi 1.5.0 and newer. It uses Pi's public `before_agent_start` extension hook.

## Behavior

- Targets only `muryo/gemini-4-hydrogen-sonar`.
- Replaces Pi's default prompt prefix with a short coding-assistant prompt.
- Keeps Pi's tool definitions, project instructions, skills, appended prompt, and working directory under Pi's normal prompt assembly.
- Leaves an explicit `--system-prompt`, `SYSTEM.md`, or forced prompt unchanged.
- Leaves other providers and models unchanged.
- Does not modify provider protocols, request headers, credentials, model settings, conversation history, or tool permissions.

This exists for compatibility with upstream services that filter Pi requests based on Pi's default prompt text. It changes prompt text only; it cannot fix quota, authentication, routing, or unrelated provider errors.

## Local development

```bash
pnpm --filter @jingoz/pi-prompt-replace check
pnpm --filter @jingoz/pi-prompt-replace test
pi -e ./packages/pi-prompt-replace --print --no-session --no-tools "Reply with exactly OK."
```

The real-model behavior still depends on the selected upstream and model. The package test covers hook behavior without sending production requests.
