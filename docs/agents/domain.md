# 领域文档

工程 skills 探索代码库时，应按以下规则读取本仓库的领域文档。

## 探索前读取

- 读取仓库根目录的 **`CONTEXT-MAP.md`**，并只加载与当前任务有关的上下文 `CONTEXT.md`。
- 读取 **`docs/adr/`** 中与当前任务有关的系统级 ADR。
- 如果相关上下文存在自己的 `docs/adr/`，同时读取其中与当前任务有关的 ADR。

如果这些文件不存在，静默继续。`/domain-modeling` skill 会在领域术语或决策真正明确后按需创建它们。

## 文件结构

本仓库使用多上下文布局：

```text
/
|-- CONTEXT-MAP.md
|-- docs/adr/
`-- packages/
    |-- <plugin-a>/
    |   |-- CONTEXT.md
    |   `-- docs/adr/
    `-- <plugin-b>/
        |-- CONTEXT.md
        `-- docs/adr/
```

`CONTEXT-MAP.md` 是上下文寻路入口。插件没有专属领域语言时不需要空的 `CONTEXT.md`；在第一个领域术语明确后再创建，并同步加入 map。

## 使用术语表中的词汇

使用相关上下文 `CONTEXT.md` 中定义的领域术语。不要把一个插件的术语带入无关插件。如果缺少所需概念，应重新考虑该用词，或记录此缺口并交由 `/domain-modeling` 处理。

## 标记 ADR 冲突

如果输出与系统级或上下文级 ADR 冲突，应明确指出，不得静默覆盖。
