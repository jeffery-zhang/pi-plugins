import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, sep } from "node:path";
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
const BEFORE_PATH_CHARACTER = /[A-Za-z0-9_.\\/-]/;
const AFTER_PATH_CHARACTER = /[A-Za-z0-9_\\/-]/;
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
  const parse = (value: string): number[] =>
    value.replace(/^v/i, "").split("-")[0]!.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(version);
  const required = parse(minimum);
  for (let index = 0; index < Math.max(current.length, required.length); index++) {
    const left = current[index] ?? 0;
    const right = required[index] ?? 0;
    if (left !== right) {
      return left > right;
    }
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

function replaceOccurrence(text: string, occurrence: ClipboardImageOccurrence): string {
  return `${text.slice(0, occurrence.start)}${IMAGE_MARKER}${text.slice(occurrence.end)}`;
}

async function handleInput(event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> {
  if (ctx.mode !== "tui" || event.source !== "interactive" || event.streamingBehavior !== undefined) {
    return { action: "continue" };
  }

  const occurrences = findClipboardImageOccurrences(event.text);
  if (occurrences.length !== 1) {
    return { action: "continue" };
  }

  const occurrence = occurrences[0];
  const mimeType = clipboardPathToMimeType(occurrence.path);
  if (!mimeType) {
    return { action: "continue" };
  }

  try {
    const bytes = await readFile(occurrence.path, { signal: ctx.signal });
    if (!isSupportedImageSignature(bytes, mimeType)) {
      return { action: "continue" };
    }
    const resized = await resizeImage(bytes, mimeType);
    if (!resized) {
      return { action: "continue" };
    }
    const image: FlatImageContent = {
      type: "image",
      data: resized.data,
      mimeType: resized.mimeType,
    };
    return {
      action: "transform",
      text: replaceOccurrence(event.text, occurrence),
      images: event.images ? [...event.images, image] : [image],
    };
  } catch {
    return { action: "continue" };
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
    pi.on("input", handleInput);
  };
}

export default function imageInput(pi: ExtensionAPI): void {
  createImageInputExtension()(pi);
}
