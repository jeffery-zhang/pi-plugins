import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, sep } from "node:path";
import { getKeybindings } from "@earendil-works/pi-tui";
import {
  VERSION,
  resizeImage,
  type ExtensionAPI,
  type ExtensionContext,
  type InputEvent,
  type InputEventResult,
} from "@earendil-works/pi-coding-agent";

const MIN_PI_VERSION = "0.84.3";
const IMAGE_MARKER = "[Image]";
const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const BEFORE_PATH_CHARACTER = /[\p{L}\p{N}_.\\/~:-]/u;
const AFTER_PATH_CHARACTER = /[\p{L}\p{N}_\\/~:-]/u;
const SUPPORTED_EXTENSION_PATTERN = "(?:[pP][nN][gG]|[jJ][pP][eE]?[gG]|[wW][eE][bB][pP])";

export interface ClipboardImageOccurrence {
  path: string;
  start: number;
  end: number;
}

interface FlatImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isSupportedPiVersion(version: string, minimum: string = MIN_PI_VERSION): boolean {
  const parse = (value: string): { core: number[]; prerelease: string[] } => {
    const [core = "", prerelease = ""] = value.replace(/^v/i, "").split("-", 2);
    return {
      core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
      prerelease: prerelease ? prerelease.split(".") : [],
    };
  };
  const current = parse(version);
  const required = parse(minimum);
  for (let index = 0; index < Math.max(current.core.length, required.core.length); index++) {
    const left = current.core[index] ?? 0;
    const right = required.core[index] ?? 0;
    if (left !== right) {
      return left > right;
    }
  }
  if (current.prerelease.length === 0 || required.prerelease.length === 0) {
    return current.prerelease.length === 0;
  }
  for (let index = 0; index < Math.max(current.prerelease.length, required.prerelease.length); index++) {
    const left = current.prerelease[index];
    const right = required.prerelease[index];
    if (left === undefined || right === undefined) {
      return right === undefined;
    }
    if (left === right) {
      continue;
    }
    const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) {
      return leftNumber > rightNumber;
    }
    if (leftNumber !== undefined || rightNumber !== undefined) {
      return rightNumber !== undefined;
    }
    return left > right;
  }
  return true;
}

function hasSafeTextBoundaries(text: string, start: number, end: number): boolean {
  const before = text[start - 1];
  if (before && BEFORE_PATH_CHARACTER.test(before)) {
    return false;
  }

  const after = text[end];
  if (!after) {
    return true;
  }
  if (AFTER_PATH_CHARACTER.test(after)) {
    return false;
  }
  return after !== "." || !text[end + 1] || !AFTER_PATH_CHARACTER.test(text[end + 1]!);
}

export function findClipboardImageOccurrences(
  text: string,
  tempDir: string = tmpdir(),
  separator: string = sep,
): ClipboardImageOccurrence[] {
  const pattern = new RegExp(
    `${escapeRegExp(tempDir)}${escapeRegExp(separator)}` +
      `pi-clipboard-${UUID_PATTERN}\\.${SUPPORTED_EXTENSION_PATTERN}`,
    "g",
  );
  const occurrences: ClipboardImageOccurrence[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (hasSafeTextBoundaries(text, start, end)) {
      occurrences.push({ path: match[0], start, end });
    }
  }
  return occurrences;
}

export function clipboardPathToMimeType(filePath: string): string | null {
  switch (extname(filePath).slice(1).toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}

export function isSupportedImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  const startsWith = (prefix: number[]): boolean =>
    prefix.every((byte, index) => bytes[index] === byte);
  switch (mimeType) {
    case "image/png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith([0xff, 0xd8, 0xff]);
    case "image/webp":
      return (
        bytes.length >= 12 &&
        startsWith([0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}

function replaceOccurrences(text: string, occurrences: ClipboardImageOccurrence[]): string {
  let transformed = text;
  for (let index = occurrences.length - 1; index >= 0; index--) {
    const occurrence = occurrences[index]!;
    transformed = `${transformed.slice(0, occurrence.start)}${IMAGE_MARKER}${transformed.slice(occurrence.end)}`;
  }
  return transformed;
}

function restoreImageDraft(
  ctx: ExtensionContext,
  text: string,
  message: string,
): Extract<InputEventResult, { action: "handled" }> {
  if (ctx.hasUI) {
    try {
      ctx.ui.setEditorText(text);
    } catch {
      // Input interception must remain fail-closed even if the UI cannot restore the draft.
    }
    try {
      ctx.ui.notify(message, "error");
    } catch {
      // A notification failure must not release the raw path to the provider.
    }
  }
  return { action: "handled" };
}

function failureMessage(error: unknown, filePath?: string): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Image submission cancelled; the draft was restored";
  }
  const target = filePath ? ` ${basename(filePath)}` : "";
  return `Could not attach${target}; the draft was restored`;
}

async function handleInput(event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> {
  if (ctx.mode !== "tui" || event.source !== "interactive") {
    return { action: "continue" };
  }

  const occurrences = findClipboardImageOccurrences(event.text);
  if (occurrences.length === 0) {
    return { action: "continue" };
  }
  const streamingBehavior = event.streamingBehavior;
  const hasNativeDeliveryPath =
    ctx.isIdle() || streamingBehavior === "steer" || streamingBehavior === "followUp";
  if (!hasNativeDeliveryPath) {
    return restoreImageDraft(
      ctx,
      event.text,
      "Clipboard images cannot be submitted in the current Pi state; the draft was restored",
    );
  }

  let currentPath: string | undefined;
  try {
    if (!ctx.model?.input.includes("image")) {
      return restoreImageDraft(
        ctx,
        event.text,
        "Current model does not support image input; the draft was restored",
      );
    }

    const normalizedByPath = new Map<string, FlatImageContent>();
    const images: FlatImageContent[] = [];
    for (const occurrence of occurrences) {
      currentPath = occurrence.path;
      ctx.signal?.throwIfAborted();
      let image = normalizedByPath.get(occurrence.path);
      if (!image) {
        const mimeType = clipboardPathToMimeType(occurrence.path);
        if (!mimeType) {
          throw new Error("Unsupported clipboard image type");
        }
        const bytes = await readFile(occurrence.path, { signal: ctx.signal });
        if (!isSupportedImageSignature(bytes, mimeType)) {
          throw new Error("Clipboard image content does not match its extension");
        }
        const resized = await resizeImage(bytes, mimeType);
        ctx.signal?.throwIfAborted();
        if (!resized) {
          throw new Error("Clipboard image could not be normalized");
        }
        image = {
          type: "image",
          data: resized.data,
          mimeType: resized.mimeType,
        };
        normalizedByPath.set(occurrence.path, image);
      }
      images.push(image);
    }
    return {
      action: "transform",
      text: replaceOccurrences(event.text, occurrences),
      images: event.images ? [...event.images, ...images] : images,
    };
  } catch (error) {
    return restoreImageDraft(ctx, event.text, failureMessage(error, currentPath));
  }
}

export function createImageInputExtension(version: string = VERSION) {
  return function imageInput(pi: ExtensionAPI): void {
    if (!isSupportedPiVersion(version)) {
      let warned = false;
      pi.on("session_start", (_event, ctx) => {
        if (ctx.mode === "tui" && ctx.hasUI && !warned) {
          warned = true;
          ctx.ui.notify("Image Input requires Pi 0.84.3 or newer", "warning");
        }
      });
      return;
    }
    let compactionActive = false;
    let unsubscribeTerminalInput: (() => void) | undefined;

    const stopTerminalGuard = (): void => {
      unsubscribeTerminalInput?.();
      unsubscribeTerminalInput = undefined;
    };

    pi.on("session_start", (_event, ctx) => {
      compactionActive = false;
      stopTerminalGuard();
      if (ctx.mode !== "tui") {
        return;
      }
      unsubscribeTerminalInput = ctx.ui.onTerminalInput((data) => {
        if (!compactionActive) {
          return undefined;
        }
        const keybindings = getKeybindings();
        const isSubmit =
          keybindings.matches(data, "tui.input.submit") ||
          keybindings.matches(data, "app.message.followUp" as "tui.input.submit");
        if (!isSubmit || findClipboardImageOccurrences(ctx.ui.getEditorText()).length === 0) {
          return undefined;
        }
        if (ctx.hasUI) {
          try {
            ctx.ui.notify("Clipboard images cannot be submitted during compaction", "warning");
          } catch {
            // Feedback failure must not release the image draft into the compaction queue.
          }
        }
        return { consume: true };
      });
    });
    pi.on("session_before_compact", () => {
      compactionActive = true;
    });
    pi.on("session_compact", () => {
      compactionActive = false;
    });
    pi.on("session_compact_failed", () => {
      compactionActive = false;
    });
    pi.on("session_shutdown", () => {
      compactionActive = false;
      stopTerminalGuard();
    });
    pi.on("input", handleInput);
  };
}

export default function imageInput(pi: ExtensionAPI): void {
  createImageInputExtension()(pi);
}
