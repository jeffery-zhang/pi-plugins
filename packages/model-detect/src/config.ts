import { randomUUID } from "node:crypto";
import { open, readFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { applyEdits, modify, parse, parseTree, type Node, type ParseError } from "jsonc-parser";
import { record, type RecordValue } from "./catalog.ts";

export interface Document { path: string; bytes?: Buffer; text: string; data: RecordValue }

export async function document(path: string, fallback: RecordValue): Promise<Document> {
  let bytes: Buffer;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("配置必须是普通文件（不支持符号链接或硬链接）。");
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, text: JSON.stringify(fallback, null, 2) + "\n", data: fallback };
    throw new Error("无法读取配置；请检查文件类型和权限。");
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("配置不是有效 UTF-8，已停止写入。"); }
  const errors: ParseError[] = [];
  const data: unknown = parse(text.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: false });
  if (errors.length || !record(data)) throw new Error("配置 JSON 无效；请先修复配置。");
  const uniqueKeys = (node: Node): boolean => {
    const children = node.children ?? [];
    if (node.type === "object" && new Set(children.map(child => child.children?.[0]?.value)).size !== children.length) return false;
    return children.every(uniqueKeys);
  };
  if (!uniqueKeys(parseTree(text.replace(/^\uFEFF/, ""))!)) throw new Error("配置存在重复键，已停止写入。");
  return { path, bytes, text, data };
}

export function edit(text: string, path: (string | number)[], value: unknown): string {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = text.slice(bom.length);
  const indent = body.match(/\n([\t ]+)"/)?.[1] ?? "  ";
  return bom + applyEdits(body, modify(body, path, value, {
    formattingOptions: { insertSpaces: !indent.includes("\t"), tabSize: indent.length, eol: body.includes("\r\n") ? "\r\n" : "\n" },
  }));
}

export function providers(doc: Document): RecordValue {
  if (!record(doc.data.providers)) throw new Error("模型配置缺少 providers 对象。");
  for (const value of Object.values(doc.data.providers)) {
    if (!record(value) || (value.models !== undefined && (!Array.isArray(value.models) || !value.models.every(model => record(model) && typeof model.id === "string"))) ||
      (value.modelOverrides !== undefined && (!record(value.modelOverrides) || !Object.values(value.modelOverrides).every(record)))) {
      throw new Error("模型配置的 provider、models 或 modelOverrides 结构无效。");
    }
  }
  return doc.data.providers;
}

export function mappings(doc: Document): Map<string, string> {
  if (!record(doc.data.sources) || !Object.entries(doc.data.sources).every(([key, value]) => key.includes("/") && typeof value === "string" && value.includes("/"))) {
    throw new Error("来源映射配置结构无效。");
  }
  return new Map(Object.entries(doc.data.sources) as [string, string][]);
}

export async function unchanged(doc: Document): Promise<boolean> {
  try { return (await readFile(doc.path)).equals(doc.bytes ?? Buffer.alloc(0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return doc.bytes === undefined; throw error; }
}

export type Rename = typeof rename;

export async function save(root: string, changes: { doc: Document; text: string }[], signal: AbortSignal, move: Rename = rename): Promise<string> {
  signal.throwIfAborted();
  const active = changes.filter(({ doc, text }) => text !== doc.text);
  if (!active.length) throw new Error("没有需要保存的变化。");
  for (const { doc } of changes) if (!await unchanged(doc)) throw new Error("配置已被其他进程更改；请重新运行 /detect。");
  const backup = join(root, "model-detect", "backups", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID());
  await mkdir(backup, { recursive: true, mode: 0o700 });
  const staged: { doc: Document; temporary: string; written: Buffer }[] = [];
  const published: typeof staged = [];
  try {
    for (const { doc, text } of active) {
      const name = doc.path.endsWith("models.json") ? "models.json" : "model-detect.json";
      if (doc.bytes) {
        const handle = await open(join(backup, name), "wx", 0o600);
        try { await handle.writeFile(doc.bytes); await handle.sync(); } finally { await handle.close(); }
      }
      const temporary = doc.path + "." + randomUUID() + ".tmp";
      const written = Buffer.from(text, "utf8");
      staged.push({ doc, temporary, written });
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(written); await handle.sync(); } finally { await handle.close(); }
    }
    for (const { doc } of changes) if (!await unchanged(doc)) throw new Error("配置已被其他进程更改；请重新运行 /detect。");
    signal.throwIfAborted();
    // Once publication starts, finish or roll back before honoring cancellation.
    for (const item of staged) {
      if (!await unchanged(item.doc)) throw new Error("配置在发布时发生并发更改。");
      await move(item.temporary, item.doc.path);
      published.push(item);
    }
    return backup;
  } catch {
    let recovered = true;
    for (const item of published.reverse()) {
      try {
        if (!(await readFile(item.doc.path)).equals(item.written)) { recovered = false; continue; }
        if (item.doc.bytes) {
          const handle = await open(item.temporary, "wx", 0o600);
          try { await handle.writeFile(item.doc.bytes); await handle.sync(); } finally { await handle.close(); }
          await rename(item.temporary, item.doc.path);
        } else await rm(item.doc.path);
      } catch { recovered = false; }
    }
    throw new Error(`保存失败；${recovered ? "本次已发布改动已回退，原配置保留" : "存在并发修改或回退失败，请检查配置并使用备份恢复"}。备份：${backup}`);
  } finally {
    await Promise.all(staged.map(item => rm(item.temporary, { force: true }).catch(() => {})));
  }
}
