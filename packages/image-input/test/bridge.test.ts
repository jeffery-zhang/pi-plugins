import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  KeybindingsManager,
  getKeybindings,
  setKeybindings,
  TUI_KEYBINDINGS,
  type EditorComponent,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";
import {
  clipboardPathToMimeType,
  createImageInputExtension,
  findClipboardImageOccurrences,
  isSupportedImageSignature,
  isSupportedPiVersion,
} from "../src/index.ts";

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const JPEG_BYTES = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAABAAEDAREAAhEBAxEB/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzqvjT+kT/2Q==",
    "base64",
  ),
);
const WEBP_BYTES = Uint8Array.from(
  Buffer.from("UklGRhwAAABXRUJQVlA4TBAAAAAvAAAAEM1VICIC0f8oYAIA", "base64"),
);
const GIF_BYTES = Uint8Array.from(
  Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"),
);

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return chunk;
}

function createRgbaPng(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    const offset = row * (width * 4 + 1);
    rows[offset] = 0;
    rows.fill(0xff, offset + 1, offset + width * 4 + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngDimensions(data: string): { width: number; height: number } {
  const bytes = Buffer.from(data, "base64");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

interface Harness {
  ctx: ExtensionContext;
  handler: (event: InputEvent, context: ExtensionContext) => Promise<InputEventResult | undefined>;
  hasInputHandler: boolean;
  sessionStart?: (...args: unknown[]) => unknown;
  sessionBeforeCompact?: (...args: unknown[]) => unknown;
  sessionCompact?: (...args: unknown[]) => unknown;
  sessionCompactFailed?: (...args: unknown[]) => unknown;
  sessionShutdown?: (...args: unknown[]) => unknown;
  terminalInput?: (data: string) => { consume?: boolean; data?: string } | undefined;
  notifications: Array<{ message: string; type?: string }>;
  editorTexts: string[];
  editorValue: { value: string };
  getUnsubscribeCount: () => number;
  calls: string[];
  editor?: EditorComponent;
  entries: Array<{ type: "custom"; customType: string; data: { nextImageId: number } }>;
}

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;
const editorTui = { terminal: { rows: 40 }, requestRender() {} } as unknown as TUI;
const editorTheme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;

function createHarness(version = "0.84.3"): Harness {
  setKeybindings(
    new KeybindingsManager({
      ...TUI_KEYBINDINGS,
      "app.message.followUp": { defaultKeys: "ctrl+q", description: "Queue follow-up message" },
    }),
  );
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const notifications: Harness["notifications"] = [];
  const editorTexts: string[] = [];
  const editorValue = { value: "" };
  let terminalInput: Harness["terminalInput"];
  let unsubscribeCount = 0;
  const calls: string[] = [];
  const entries: Harness["entries"] = [];
  let editor: EditorComponent | undefined;
  let editorFactory: EditorFactory | undefined;
  const fakePi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    },
    setEditorComponent: () => {
      calls.push("setEditorComponent");
    },
    appendEntry: (customType: string, data: { nextImageId: number }) => {
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "tui",
    hasUI: true,
    signal: undefined,
    model: { input: ["text", "image"] },
    isIdle: () => true,
    cwd: process.cwd(),
    sessionManager: { getEntries: () => entries },
    ui: {
      notify: (message: string, type?: string) => {
        notifications.push({ message, type });
      },
      setEditorText: (text: string) => {
        editorTexts.push(text);
        editorValue.value = text;
        editor?.setText(text);
      },
      getEditorText: () => editor?.getExpandedText?.() ?? editor?.getText() ?? editorValue.value,
      getEditorComponent: () => editorFactory,
      setEditorComponent: (factory: EditorFactory | undefined) => {
        calls.push("setEditorComponent");
        const text = editor?.getText() ?? editorValue.value;
        editorFactory = factory;
        editor = factory?.(editorTui, editorTheme, getKeybindings() as Parameters<EditorFactory>[2]);
        editor?.setText(text);
        editorValue.value = text;
      },
      onTerminalInput: (handler: Harness["terminalInput"]) => {
        terminalInput = handler;
        return () => {
          unsubscribeCount++;
          terminalInput = undefined;
        };
      },
    },
  } as unknown as ExtensionContext;

  createImageInputExtension(version)(fakePi);

  const registeredInput = handlers.get("input");
  const handler = (registeredInput ?? (async () => ({ action: "continue" as const }))) as Harness["handler"];
  return {
    ctx,
    handler,
    hasInputHandler: registeredInput !== undefined,
    get terminalInput() {
      return terminalInput;
    },
    sessionStart: handlers.get("session_start"),
    sessionBeforeCompact: handlers.get("session_before_compact"),
    sessionCompact: handlers.get("session_compact"),
    sessionCompactFailed: handlers.get("session_compact_failed"),
    sessionShutdown: handlers.get("session_shutdown"),
    notifications,
    editorTexts,
    editorValue,
    getUnsubscribeCount: () => unsubscribeCount,
    calls,
    entries,
    get editor() { return editor; },
  };
}

function writeClipboardImage(extension: string, bytes: Uint8Array): string {
  const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.${extension}`);
  writeFileSync(filePath, bytes);
  return filePath;
}

function assertTransform(
  result: InputEventResult | undefined,
): Extract<InputEventResult, { action: "transform" }> {
  assert.ok(result);
  assert.equal(result.action, "transform");
  return result as Extract<InputEventResult, { action: "transform" }>;
}

test("clipboard images are numbered in the editor before submission and keep their attachments", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  try {
    const harness = createHarness();
    await harness.sessionStart?.({ type: "session_start", reason: "startup" }, harness.ctx);
    assert.ok(harness.editor);
    harness.editor.insertTextAtCursor?.(`Review ${filePath}`);
    assert.equal(harness.editor.getText(), "Review [Image 1]");
    assert.equal(harness.editor.getExpandedText?.(), "Review [Image 1]");
    assert.ok(!harness.editor.render(80).join("\n").includes(filePath));
    const result = assertTransform(await harness.handler(
      { type: "input", source: "interactive", text: harness.editor.getText() }, harness.ctx,
    ));
    assert.equal(result.text, "Review [Image 1]");
    assert.equal(result.images?.length, 1);
    assert.equal(result.images[0]?.mimeType, "image/png");
    harness.ctx.ui.setEditorText(`Review ${filePath}`);
    assert.equal(harness.editor.getText(), "Review [Image 1]");
    await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, harness.ctx);
    assert.equal(harness.ctx.ui.getEditorText(), `Review ${filePath}`);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("image presentation composes with an existing editor and restores its factory", async () => {
  const harness = createHarness();
  const existing = new CustomEditor(editorTui, editorTheme, getKeybindings() as Parameters<EditorFactory>[2]);
  const submit = () => {};
  existing.onSubmit = submit;
  const previousFactory: EditorFactory = () => existing;
  harness.ctx.ui.setEditorComponent(previousFactory);
  await harness.sessionStart?.({ type: "session_start", reason: "startup" }, harness.ctx);
  assert.equal(harness.editor, existing);
  assert.equal(harness.editor.onSubmit, submit);
  assert.notEqual(harness.ctx.ui.getEditorComponent(), previousFactory);
  const filePath = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  harness.editor.insertTextAtCursor?.(filePath);
  assert.equal(harness.editor.getText(), "[Image 1]");
  await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, harness.ctx);
  assert.equal(harness.ctx.ui.getEditorComponent(), previousFactory);
  assert.equal(harness.ctx.ui.getEditorText(), filePath);
});

test("shutdown never replaces an editor installed later by another extension", async () => {
  const harness = createHarness();
  await harness.sessionStart?.({ type: "session_start", reason: "startup" }, harness.ctx);
  const laterFactory: EditorFactory = (...args) => new CustomEditor(...args);
  harness.ctx.ui.setEditorComponent(laterFactory);
  await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, harness.ctx);
  assert.equal(harness.ctx.ui.getEditorComponent(), laterFactory);
});

test("adjacent image markers submit in order and survive native history recovery", async () => {
  const first = writeClipboardImage("png", PNG_BYTES);
  const second = writeClipboardImage("jpg", JPEG_BYTES);
  try {
    const harness = createHarness();
    await harness.sessionStart?.({ type: "session_start", reason: "startup" }, harness.ctx);
    const editor = harness.editor!;
    editor.insertTextAtCursor?.(first);
    editor.insertTextAtCursor?.(second);
    assert.equal(editor.getText(), "[Image 1][Image 2]");
    let submitted = "";
    editor.onSubmit = (text) => { submitted = text; };
    editor.handleInput("\r");
    assert.equal(submitted, "[Image 1][Image 2]");
    const result = assertTransform(await harness.handler(
      { type: "input", source: "interactive", text: submitted }, harness.ctx,
    ));
    assert.equal(result.text, submitted);
    assert.deepEqual(result.images?.map((image) => image.mimeType), ["image/png", "image/jpeg"]);
    harness.ctx.ui.setEditorText(result.text);
    const recovered = assertTransform(await harness.handler(
      { type: "input", source: "interactive", text: harness.ctx.ui.getEditorText(), streamingBehavior: "followUp" },
      { ...harness.ctx, isIdle: () => false },
    ));
    assert.equal(recovered.text, submitted);
    assert.deepEqual(recovered.images, result.images);
    await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, harness.ctx);
  } finally {
    rmSync(first, { force: true });
    rmSync(second, { force: true });
  }
});

test("failed marker submissions restore visible markers and never release a bare path", async () => {
  const missing = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  const harness = createHarness();
  await harness.sessionStart?.({ type: "session_start", reason: "startup" }, harness.ctx);
  harness.editor!.insertTextAtCursor?.(missing);
  assert.deepEqual(await harness.handler(
    { type: "input", source: "interactive", text: "[Image 1]" }, harness.ctx,
  ), { action: "handled" });
  assert.equal(harness.editor!.getText(), "[Image 1]");
  assert.equal(harness.ctx.ui.getEditorText(), "[Image 1]");
  await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, harness.ctx);
});

test("non-TUI startup never installs an editor or terminal listener", async () => {
  for (const mode of ["rpc", "json", "print"] as const) {
    const harness = createHarness();
    await harness.sessionStart?.({ type: "session_start", reason: "startup" }, { ...harness.ctx, mode });
    assert.equal(harness.editor, undefined);
    assert.equal(harness.terminalInput, undefined);
    assert.deepEqual(harness.calls, []);
  }
});

test("reload never reuses an old image number for a different clipboard file", async () => {
  const harness = createHarness();
  harness.entries.push({ type: "custom", customType: "image-input", data: { nextImageId: 8 } });
  await harness.sessionStart?.({ type: "session_start", reason: "startup" }, harness.ctx);
  const path = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  harness.editor!.insertTextAtCursor?.(path);
  assert.equal(harness.editor!.getText(), "[Image 8]");
  assert.deepEqual(harness.entries.at(-1)?.data, { nextImageId: 9 });
  assert.deepEqual(await harness.handler(
    { type: "input", source: "interactive", text: "[Image 1]" }, harness.ctx,
  ), { action: "continue" });
  await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, harness.ctx);
});

test("version guard accepts 0.84.3 stable and newer", () => {
  assert.equal(isSupportedPiVersion("0.84.2"), false);
  assert.equal(isSupportedPiVersion("0.84.3-beta.1"), false);
  assert.equal(isSupportedPiVersion("v0.84.3"), true);
  assert.equal(isSupportedPiVersion("0.84.3"), true);
  assert.equal(isSupportedPiVersion("0.84.4-alpha.1"), true);
  assert.equal(isSupportedPiVersion("0.85.0"), true);
  assert.equal(isSupportedPiVersion("1.0.0"), true);
  assert.equal(isSupportedPiVersion("1.2.3-beta.2", "1.2.3-beta.1"), true);
  assert.equal(isSupportedPiVersion("1.2.3-beta.1", "1.2.3-beta.2"), false);
});

test("below 0.84.3 stays inert and warns once in TUI", async () => {
  const harness = createHarness("0.84.2");
  assert.equal(harness.hasInputHandler, false);
  assert.ok(harness.sessionStart);

  await harness.sessionStart({ type: "session_start" }, harness.ctx);
  await harness.sessionStart({ type: "session_start" }, harness.ctx);
  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0]?.message, "Image Input requires Pi 0.84.3 or newer");
  assert.equal(harness.notifications[0]?.type, "warning");

  const printHarness = createHarness("0.84.2");
  const printCtx = { ...printHarness.ctx, mode: "print", hasUI: false } as unknown as ExtensionContext;
  await printHarness.sessionStart?.({ type: "session_start" }, printCtx);
  assert.equal(printHarness.notifications.length, 0);
  assert.equal(harness.calls.includes("setEditorComponent"), false);
});

test("recognizes Windows/POSIX canonical paths, temp dir spaces, and safe boundaries", () => {
  const uuid = randomUUID();
  const windowsTemp = "C:\\Users\\Test User\\AppData\\Local\\Temp";
  const windowsPath = `${windowsTemp}\\pi-clipboard-${uuid}.png`;
  assert.equal(findClipboardImageOccurrences(windowsPath, windowsTemp, "\\").length, 1);
  assert.equal(findClipboardImageOccurrences(`before ${windowsPath} after`, windowsTemp, "\\").length, 1);
  assert.equal(findClipboardImageOccurrences(`x${windowsPath}`, windowsTemp, "\\").length, 0);
  assert.equal(findClipboardImageOccurrences(`file:${windowsPath}`, windowsTemp, "\\").length, 0);
  assert.equal(findClipboardImageOccurrences(`~${windowsPath}`, windowsTemp, "\\").length, 0);
  assert.equal(findClipboardImageOccurrences(`${windowsPath}:stream`, windowsTemp, "\\").length, 0);
  assert.equal(findClipboardImageOccurrences(`${windowsPath}.txt`, windowsTemp, "\\").length, 0);
  assert.equal(findClipboardImageOccurrences(`D:\\other\\${windowsPath}`, windowsTemp, "\\").length, 0);

  const posixTemp = "/tmp/temp dir";
  const posixPath = `${posixTemp}/pi-clipboard-${uuid}.jpeg`;
  assert.equal(findClipboardImageOccurrences(posixPath, posixTemp, "/").length, 1);
  assert.equal(findClipboardImageOccurrences(`(${posixPath})`, posixTemp, "/").length, 1);
  assert.equal(findClipboardImageOccurrences(`${posixPath}x`, posixTemp, "/").length, 0);
  assert.equal(
    findClipboardImageOccurrences(`${posixTemp}/nested/pi-clipboard-${uuid}.png`, posixTemp, "/").length,
    0,
  );
  assert.equal(
    findClipboardImageOccurrences(`${posixTemp}/pi-clipboard-${uuid}.gif`, posixTemp, "/").length,
    0,
  );
  assert.equal(
    findClipboardImageOccurrences(`${posixTemp}/pi-clipboard-${uuid}.PNG`, posixTemp, "/").length,
    1,
  );
});

test("mime mapping and content signatures cover supported formats", () => {
  assert.equal(clipboardPathToMimeType("C:\\temp\\pi-clipboard-1.png"), "image/png");
  assert.equal(clipboardPathToMimeType("/tmp/pi-clipboard-1.jpg"), "image/jpeg");
  assert.equal(clipboardPathToMimeType("/tmp/pi-clipboard-1.jpeg"), "image/jpeg");
  assert.equal(clipboardPathToMimeType("/tmp/pi-clipboard-1.webp"), "image/webp");
  assert.equal(clipboardPathToMimeType("/tmp/pi-clipboard-1.gif"), null);

  assert.equal(isSupportedImageSignature(PNG_BYTES, "image/png"), true);
  assert.equal(isSupportedImageSignature(JPEG_BYTES, "image/jpeg"), true);
  assert.equal(isSupportedImageSignature(WEBP_BYTES, "image/webp"), true);
  assert.equal(isSupportedImageSignature(PNG_BYTES, "image/jpeg"), false);
  assert.equal(isSupportedImageSignature(JPEG_BYTES, "image/webp"), false);
});

test("converts a single canonical PNG/JPEG/WebP path to marker and flat image content", async () => {
  const fixtures = [
    { extension: "png", mimeType: "image/png", bytes: PNG_BYTES },
    { extension: "jpg", mimeType: "image/jpeg", bytes: JPEG_BYTES },
    { extension: "jpeg", mimeType: "image/jpeg", bytes: JPEG_BYTES },
    { extension: "webp", mimeType: "image/webp", bytes: WEBP_BYTES },
  ];
  for (const fixture of fixtures) {
    const filePath = writeClipboardImage(fixture.extension, fixture.bytes);
    try {
      const harness = createHarness();
      const result = assertTransform(
        await harness.handler(
          { type: "input", source: "interactive", text: filePath },
          harness.ctx,
        ),
      );
      assert.equal(result.text, "[Image 1]");
      assert.ok(!result.text.includes("pi-clipboard-"));
      assert.ok(result.images);
      assert.equal(result.images.length, 1);
      const image = result.images[0];
      assert.equal(image.type, "image");
      if (image.type !== "image") throw new Error("expected image content");
      assert.equal(image.mimeType, fixture.mimeType);
      assert.deepEqual(Buffer.from(image.data, "base64"), Buffer.from(fixture.bytes));
    } finally {
      rmSync(filePath, { force: true });
    }
  }
});

test("uses Pi default resizing for images wider than 2000 pixels", async () => {
  const oversized = createRgbaPng(2501, 1);
  const filePath = writeClipboardImage("png", oversized);
  try {
    const harness = createHarness();
    const result = assertTransform(
      await harness.handler(
        { type: "input", source: "interactive", text: filePath },
        harness.ctx,
      ),
    );
    assert.equal(result.images?.length, 1);
    const image = result.images?.[0];
    assert.equal(image?.type, "image");
    if (!image || image.type !== "image") throw new Error("expected image content");
    assert.equal(image.mimeType, "image/png");
    assert.deepEqual(pngDimensions(image.data), { width: 2000, height: 1 });
    assert.notDeepEqual(Buffer.from(image.data, "base64"), Buffer.from(oversized));
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("preserves surrounding text, ordinary paths, and handwritten markers", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  const ordinaryPath = join(tmpdir(), "ordinary-image.png");
  try {
    const harness = createHarness();
    const result = assertTransform(
      await harness.handler(
        {
          type: "input",
          source: "interactive",
          text: `Describe ${filePath}. Also look at ${ordinaryPath} and keep [Image] literal.`,
        },
        harness.ctx,
      ),
    );
    assert.equal(result.text, `Describe [Image 1]. Also look at ${ordinaryPath} and keep [Image] literal.`);
    assert.equal(result.images?.length, 1);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("keeps existing images first and appends the plugin image", async () => {
  const filePath = writeClipboardImage("webp", WEBP_BYTES);
  const existing = [
    { type: "image" as const, data: "existing-data", mimeType: "image/png" },
  ];
  try {
    const harness = createHarness();
    const result = assertTransform(
      await harness.handler(
        { type: "input", source: "interactive", text: `Analyze ${filePath}`, images: existing },
        harness.ctx,
      ),
    );
    assert.equal(result.text, "Analyze [Image 1]");
    assert.ok(result.images);
    assert.equal(result.images.length, 2);
    assert.equal(result.images[0], existing[0]);
    const image = result.images[1];
    assert.equal(image.type, "image");
    if (image.type !== "image") throw new Error("expected image content");
    assert.equal(image.mimeType, "image/webp");
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("passes through GIF, ordinary paths, noncanonical paths, and handwritten markers", async () => {
  const gifPath = writeClipboardImage("gif", GIF_BYTES);
  const ordinaryPath = join(tmpdir(), "ordinary-image.png");
  const noncanonicalPath = join(tmpdir(), "nested", "pi-clipboard-not-a-uuid.png");
  const harness = createHarness();
  const base: InputEvent = { type: "input", source: "interactive", text: "" };
  for (const text of [gifPath, ordinaryPath, noncanonicalPath, "[Image]"]) {
    assert.deepEqual(await harness.handler({ ...base, text }, harness.ctx), { action: "continue" });
  }
  rmSync(gifPath, { force: true });
});

test("converts every eligible occurrence in order and preserves existing images first", async () => {
  const first = writeClipboardImage("png", PNG_BYTES);
  const second = writeClipboardImage("jpg", JPEG_BYTES);
  const gif = writeClipboardImage("gif", GIF_BYTES);
  const ordinary = join(tmpdir(), "ordinary-image.png");
  const existing = { type: "image" as const, data: "existing-data", mimeType: "image/png" };
  try {
    const harness = createHarness();
    const result = assertTransform(
      await harness.handler(
        {
          type: "input",
          source: "interactive",
          text: `First ${first}; handwritten [Image]; second ${second}; gif ${gif}; ordinary ${ordinary}`,
          images: [existing],
        },
        harness.ctx,
      ),
    );
    assert.equal(
      result.text,
      `First [Image 1]; handwritten [Image]; second [Image 2]; gif ${gif}; ordinary ${ordinary}`,
    );
    assert.ok(result.images);
    assert.equal(result.images.length, 3);
    assert.equal(result.images[0], existing);
    assert.equal(result.images[1]?.type, "image");
    assert.equal(result.images[1]?.mimeType, "image/png");
    assert.equal(result.images[2]?.type, "image");
    assert.equal(result.images[2]?.mimeType, "image/jpeg");
  } finally {
    rmSync(first, { force: true });
    rmSync(second, { force: true });
    rmSync(gif, { force: true });
  }
});

test("repeated clipboard paths produce one marker and attachment per occurrence", async () => {
  const filePath = writeClipboardImage("webp", WEBP_BYTES);
  try {
    const harness = createHarness();
    const result = assertTransform(
      await harness.handler(
        { type: "input", source: "interactive", text: `${filePath} then ${filePath}` },
        harness.ctx,
      ),
    );
    assert.equal(result.text, "[Image 1] then [Image 1]");
    assert.equal(result.images?.length, 2);
    assert.deepEqual(result.images?.[0], result.images?.[1]);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("fails closed and restores the exact draft for invalid or unreadable images", async () => {
  const mismatched = writeClipboardImage("png", JPEG_BYTES);
  const malformed = writeClipboardImage("png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const missing = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  try {
    for (const filePath of [mismatched, malformed, missing]) {
      const harness = createHarness();
      const text = `Keep this exact draft: ${filePath}`;
      assert.deepEqual(
        await harness.handler({ type: "input", source: "interactive", text }, harness.ctx),
        { action: "handled" },
      );
      assert.deepEqual(harness.editorTexts, [text]);
      assert.equal(harness.notifications.length, 1);
      assert.equal(harness.notifications[0]?.type, "error");
      assert.match(harness.notifications[0]?.message ?? "", /pi-clipboard-/);
    }
  } finally {
    rmSync(mismatched, { force: true });
    rmSync(malformed, { force: true });
  }
});

test("fails the whole draft when any image fails", async () => {
  const valid = writeClipboardImage("png", PNG_BYTES);
  const invalid = writeClipboardImage("jpg", PNG_BYTES);
  try {
    const harness = createHarness();
    const text = `${valid} then ${invalid}`;
    assert.deepEqual(
      await harness.handler({ type: "input", source: "interactive", text }, harness.ctx),
      { action: "handled" },
    );
    assert.deepEqual(harness.editorTexts, [text]);
    assert.equal(harness.notifications.length, 1);
  } finally {
    rmSync(valid, { force: true });
    rmSync(invalid, { force: true });
  }
});

test("blocks image drafts for models without image input", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  try {
    const harness = createHarness();
    const textOnlyModel = { ...harness.ctx, model: { input: ["text"] } } as unknown as ExtensionContext;
    assert.deepEqual(
      await harness.handler({ type: "input", source: "interactive", text: filePath }, textOnlyModel),
      { action: "handled" },
    );
    assert.deepEqual(harness.editorTexts, [filePath]);
    assert.match(harness.notifications[0]?.message ?? "", /does not support image input/i);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("aborted image processing fails closed", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  try {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();
    const abortedCtx = { ...harness.ctx, signal: controller.signal } as ExtensionContext;
    assert.deepEqual(
      await harness.handler({ type: "input", source: "interactive", text: filePath }, abortedCtx),
      { action: "handled" },
    );
    assert.deepEqual(harness.editorTexts, [filePath]);
    assert.match(harness.notifications[0]?.message ?? "", /cancelled/i);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("UI failures cannot make image processing fail open", async () => {
  const missing = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  const harness = createHarness();
  const brokenUiCtx = {
    ...harness.ctx,
    ui: {
      ...harness.ctx.ui,
      setEditorText: () => {
        throw new Error("editor unavailable");
      },
      notify: () => {
        throw new Error("notification unavailable");
      },
    },
  } as ExtensionContext;
  assert.deepEqual(
    await harness.handler({ type: "input", source: "interactive", text: missing }, brokenUiCtx),
    { action: "handled" },
  );
});

test("converts image drafts through idle, steer, and follow-up delivery paths", async () => {
  const first = writeClipboardImage("png", PNG_BYTES);
  const second = writeClipboardImage("jpg", JPEG_BYTES);
  const existing = { type: "image" as const, data: "existing-data", mimeType: "image/webp" };
  try {
    for (const streamingBehavior of [undefined, "steer", "followUp"] as const) {
      const harness = createHarness();
      const ctx = {
        ...harness.ctx,
        isIdle: () => streamingBehavior === undefined,
      } as ExtensionContext;
      const result = assertTransform(
        await harness.handler(
          {
            type: "input",
            source: "interactive",
            text: `First ${first}; repeat ${first}; second ${second}`,
            images: [existing],
            streamingBehavior,
          },
          ctx,
        ),
      );
      assert.equal(result.text, "First [Image 1]; repeat [Image 1]; second [Image 2]");
      assert.equal(result.images?.length, 4);
      assert.equal(result.images?.[0], existing);
      assert.equal(result.images?.[1]?.mimeType, "image/png");
      assert.deepEqual(result.images?.[1], result.images?.[2]);
      assert.equal(result.images?.[3]?.mimeType, "image/jpeg");
      assert.deepEqual(harness.editorTexts, []);
      assert.deepEqual(harness.notifications, []);
    }
  } finally {
    rmSync(first, { force: true });
    rmSync(second, { force: true });
  }
});

test("multiple queued transforms remain independent on one extension instance", async () => {
  const first = writeClipboardImage("png", PNG_BYTES);
  const second = writeClipboardImage("webp", WEBP_BYTES);
  try {
    const harness = createHarness();
    const ctx = { ...harness.ctx, isIdle: () => false } as ExtensionContext;
    const steer = assertTransform(
      await harness.handler(
        {
          type: "input",
          source: "interactive",
          text: `Steer ${first} and ${first}`,
          streamingBehavior: "steer",
        },
        ctx,
      ),
    );
    const followUp = assertTransform(
      await harness.handler(
        {
          type: "input",
          source: "interactive",
          text: `Follow up ${second}`,
          streamingBehavior: "followUp",
        },
        ctx,
      ),
    );

    assert.equal(steer.text, "Steer [Image 1] and [Image 1]");
    assert.equal(steer.images?.length, 2);
    assert.equal(followUp.text, "Follow up [Image 2]");
    assert.equal(followUp.images?.length, 1);
    assert.equal(followUp.images?.[0]?.mimeType, "image/webp");
    assert.deepEqual(harness.editorTexts, []);
  } finally {
    rmSync(first, { force: true });
    rmSync(second, { force: true });
  }
});

test("streaming image failures restore the exact draft and fail closed", async () => {
  const missing = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  const mismatched = writeClipboardImage("png", JPEG_BYTES);
  const malformed = writeClipboardImage(
    "png",
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  try {
    for (const streamingBehavior of ["steer", "followUp"] as const) {
      for (const filePath of [missing, mismatched, malformed]) {
        const harness = createHarness();
        const text = `Restore exactly ${filePath}`;
        const ctx = { ...harness.ctx, isIdle: () => false } as ExtensionContext;
        assert.deepEqual(
          await harness.handler(
            { type: "input", source: "interactive", text, streamingBehavior },
            ctx,
          ),
          { action: "handled" },
        );
        assert.deepEqual(harness.editorTexts, [text]);
        assert.equal(harness.notifications.at(-1)?.type, "error");
      }

      const unsupportedHarness = createHarness();
      const unsupportedText = `Unsupported ${mismatched}`;
      const unsupportedCtx = {
        ...unsupportedHarness.ctx,
        isIdle: () => false,
        model: { input: ["text"] },
      } as unknown as ExtensionContext;
      assert.deepEqual(
        await unsupportedHarness.handler(
          {
            type: "input",
            source: "interactive",
            text: unsupportedText,
            streamingBehavior,
          },
          unsupportedCtx,
        ),
        { action: "handled" },
      );
      assert.deepEqual(unsupportedHarness.editorTexts, [unsupportedText]);

      const abortedHarness = createHarness();
      const controller = new AbortController();
      controller.abort();
      const abortedText = `Cancelled ${mismatched}`;
      const abortedCtx = {
        ...abortedHarness.ctx,
        isIdle: () => false,
        signal: controller.signal,
      } as ExtensionContext;
      assert.deepEqual(
        await abortedHarness.handler(
          { type: "input", source: "interactive", text: abortedText, streamingBehavior },
          abortedCtx,
        ),
        { action: "handled" },
      );
      assert.deepEqual(abortedHarness.editorTexts, [abortedText]);
      assert.match(abortedHarness.notifications.at(-1)?.message ?? "", /cancelled/i);

      const unexpectedHarness = createHarness();
      const unexpectedText = `Unexpected ${mismatched}`;
      const unexpectedCtx = {
        ...unexpectedHarness.ctx,
        isIdle: () => false,
      } as ExtensionContext;
      Object.defineProperty(unexpectedCtx, "model", {
        get: () => {
          throw new Error("unexpected model lookup failure");
        },
      });
      assert.deepEqual(
        await unexpectedHarness.handler(
          { type: "input", source: "interactive", text: unexpectedText, streamingBehavior },
          unexpectedCtx,
        ),
        { action: "handled" },
      );
      assert.deepEqual(unexpectedHarness.editorTexts, [unexpectedText]);
    }
  } finally {
    rmSync(mismatched, { force: true });
    rmSync(malformed, { force: true });
  }
});

test("text-only streaming input passes through and non-idle input without a queue path is blocked", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  try {
    const harness = createHarness();
    const streamingCtx = { ...harness.ctx, isIdle: () => false } as ExtensionContext;
    for (const streamingBehavior of ["steer", "followUp"] as const) {
      assert.deepEqual(
        await harness.handler(
          { type: "input", source: "interactive", text: "plain text", streamingBehavior },
          streamingCtx,
        ),
        { action: "continue" },
      );
    }

    const text = `No native delivery path ${filePath}`;
    assert.deepEqual(
      await harness.handler({ type: "input", source: "interactive", text }, streamingCtx),
      { action: "handled" },
    );
    assert.equal(harness.editorTexts.at(-1), text);
    assert.match(harness.notifications.at(-1)?.message ?? "", /current Pi state/i);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("compaction terminal guard consumes only image-bearing submit keys and releases reliably", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  try {
    const harness = createHarness();
    await harness.sessionStart?.({ type: "session_start", reason: "startup" }, harness.ctx);
    assert.ok(harness.terminalInput);

    harness.ctx.ui.setEditorText(filePath);
    assert.equal(harness.terminalInput?.("\r"), undefined);
    await harness.sessionBeforeCompact?.({ type: "session_before_compact" }, harness.ctx);
    assert.deepEqual(harness.terminalInput?.("\r"), { consume: true });
    assert.deepEqual(harness.terminalInput?.("\x11"), { consume: true });
    assert.equal(harness.editorValue.value, filePath);
    assert.match(harness.notifications.at(-1)?.message ?? "", /compaction/i);

    harness.ctx.ui.setEditorText("plain text");
    assert.equal(harness.terminalInput?.("\r"), undefined);
    harness.ctx.ui.setEditorText(filePath);
    assert.equal(harness.terminalInput?.("x"), undefined);

    await harness.sessionCompact?.({ type: "session_compact" }, harness.ctx);
    assert.equal(harness.terminalInput?.("\r"), undefined);
    await harness.sessionBeforeCompact?.({ type: "session_before_compact" }, harness.ctx);
    await harness.sessionCompactFailed?.({ type: "session_compact_failed", aborted: false }, harness.ctx);
    assert.equal(harness.terminalInput?.("\r"), undefined);
    await harness.sessionBeforeCompact?.({ type: "session_before_compact" }, harness.ctx);
    await harness.sessionCompactFailed?.({ type: "session_compact_failed", aborted: true }, harness.ctx);
    assert.equal(harness.terminalInput?.("\r"), undefined);

    await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, harness.ctx);
    await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, harness.ctx);
    assert.equal(harness.getUnsubscribeCount(), 1);
    assert.equal(harness.terminalInput, undefined);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("compaction guard remains fail-closed when feedback is unavailable", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  try {
    for (const hasUI of [true, false]) {
      const harness = createHarness();
      const ctx = {
        ...harness.ctx,
        hasUI,
        ui: {
          ...harness.ctx.ui,
          notify: () => {
            throw new Error("notification unavailable");
          },
        },
      } as ExtensionContext;
      await harness.sessionStart?.({ type: "session_start", reason: "startup" }, ctx);
      harness.ctx.ui.setEditorText(filePath);
      await harness.sessionBeforeCompact?.({ type: "session_before_compact" }, ctx);
      assert.deepEqual(harness.terminalInput?.("\r"), { consume: true });
      assert.equal(harness.editorValue.value, filePath);
      await harness.sessionShutdown?.({ type: "session_shutdown", reason: "quit" }, ctx);
    }
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("isolates non-TUI sources and preserves existing payloads", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  const existing = [{ type: "image" as const, data: "rpc-image", mimeType: "image/jpeg" }];
  try {
    const harness = createHarness();
    const cases: Array<{ mode: ExtensionContext["mode"]; source: InputEvent["source"]; streamingBehavior?: "steer" | "followUp" }> = [
      { mode: "rpc", source: "rpc" },
      { mode: "rpc", source: "rpc", streamingBehavior: "steer" },
      { mode: "rpc", source: "rpc", streamingBehavior: "followUp" },
      { mode: "tui", source: "extension" },
      { mode: "json", source: "interactive" },
      { mode: "print", source: "interactive" },
    ];
    for (const scenario of cases) {
      const ctx = {
        ...harness.ctx,
        mode: scenario.mode,
        hasUI: scenario.mode === "tui" || scenario.mode === "rpc",
      } as ExtensionContext;
      const event: InputEvent = {
        type: "input",
        source: scenario.source,
        text: filePath,
        images: existing,
        streamingBehavior: scenario.streamingBehavior,
      };
      assert.deepEqual(await harness.handler(event, ctx), { action: "continue" });
    }
    assert.deepEqual(harness.editorTexts, []);
    assert.deepEqual(harness.notifications, []);
  } finally {
    rmSync(filePath, { force: true });
  }
});

test("preserves CLI-style files, existing images, and unknown markers", async () => {
  const harness = createHarness();
  const existing = [{ type: "image" as const, data: "cli-image", mimeType: "image/png" }];
  for (const text of ["@./image.png", "C:\\images\\photo.jpg", "[Image] [Image 2]", "`[Image]`"]) {
    assert.deepEqual(
      await harness.handler(
        { type: "input", source: "interactive", text, images: existing },
        harness.ctx,
      ),
      { action: "continue" },
    );
  }
  assert.deepEqual(harness.editorTexts, []);
  assert.deepEqual(harness.notifications, []);
});
