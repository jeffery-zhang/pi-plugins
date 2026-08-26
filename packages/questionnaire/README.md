# @jingoz/pi-questionnaire

A Pi TUI extension that registers the `questionnaire` tool for asking users one or multiple-choice questions.

## Install

```bash
pi install npm:@jingoz/pi-questionnaire
```

## Local development

```bash
pi -e ./packages/questionnaire
```

The tool only works in TUI mode. In non-interactive modes it returns a clear UI-unavailable result instead of blocking the run.
