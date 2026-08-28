import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
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

interface Harness {
  ctx: ExtensionContext;
  handler: (event: InputEvent, context: ExtensionContext) => Promise<InputEventResult | undefined>;
  hasInputHandler: boolean;
  sessionStart?: (...args: unknown[]) => unknown;
  notifications: Array<{ message: string; type?: string }>;
  calls: string[];
}

function createHarness(version = "0.84.3"): Harness {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const notifications: Harness["notifications"] = [];
  const calls: string[] = [];
  const fakePi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    },
    setEditorComponent: () => {
      calls.push("setEditorComponent");
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "tui",
    hasUI: true,
    signal: undefined,
    cwd: process.cwd(),
    ui: {
      notify: (message: string, type?: string) => {
        notifications.push({ message, type });
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
    sessionStart: handlers.get("session_start"),
    notifications,
    calls,
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

test("version guard accepts 0.84.3 and newer", () => {
  assert.equal(isSupportedPiVersion("0.84.2"), false);
  assert.equal(isSupportedPiVersion("0.84.3"), true);
  assert.equal(isSupportedPiVersion("0.84.4"), true);
  assert.equal(isSupportedPiVersion("0.85.0"), true);
  assert.equal(isSupportedPiVersion("1.0.0"), true);
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
      assert.equal(result.text, "[Image]");
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
    assert.equal(result.text, `Describe [Image]. Also look at ${ordinaryPath} and keep [Image] literal.`);
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
    assert.equal(result.text, "Analyze [Image]");
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

test("does not partially convert multiple eligible occurrences in issue 01", async () => {
  const first = writeClipboardImage("png", PNG_BYTES);
  const second = writeClipboardImage("jpg", JPEG_BYTES);
  try {
    const harness = createHarness();
    assert.deepEqual(
      await harness.handler(
        { type: "input", source: "interactive", text: `${first} ${second}` },
        harness.ctx,
      ),
      { action: "continue" },
    );
    assert.deepEqual(
      await harness.handler(
        { type: "input", source: "interactive", text: `${first} ${first}` },
        harness.ctx,
      ),
      { action: "continue" },
    );
  } finally {
    rmSync(first, { force: true });
    rmSync(second, { force: true });
  }
});

test("passes through content-signature mismatches and unreadable canonical paths", async () => {
  const mismatched = writeClipboardImage("png", JPEG_BYTES);
  const missing = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
  try {
    const harness = createHarness();
    assert.deepEqual(
      await harness.handler(
        { type: "input", source: "interactive", text: mismatched },
        harness.ctx,
      ),
      { action: "continue" },
    );
    assert.deepEqual(
      await harness.handler(
        { type: "input", source: "interactive", text: missing },
        harness.ctx,
      ),
      { action: "continue" },
    );
  } finally {
    rmSync(mismatched, { force: true });
  }
});

test("only converts TUI interactive idle input", async () => {
  const filePath = writeClipboardImage("png", PNG_BYTES);
  try {
    const harness = createHarness();
    const printCtx = { ...harness.ctx, mode: "print", hasUI: false } as unknown as ExtensionContext;
    assert.deepEqual(
      await harness.handler({ type: "input", source: "interactive", text: filePath }, printCtx),
      { action: "continue" },
    );
    assert.deepEqual(
      await harness.handler({ type: "input", source: "rpc", text: filePath }, harness.ctx),
      { action: "continue" },
    );
    assert.deepEqual(
      await harness.handler(
        { type: "input", source: "interactive", text: filePath, streamingBehavior: "steer" },
        harness.ctx,
      ),
      { action: "continue" },
    );
  } finally {
    rmSync(filePath, { force: true });
  }
});
