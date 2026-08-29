import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TOAST_TITLE = "Pi";
const TOAST_BODY_PREFIX = "Task completed \u00b7 ";
const TOAST_TIMEOUT_MS = 15_000;

function utf8Base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export function buildWindowsToastCommand(body: string): string {
  const type = "Windows.UI.Notifications";
  const manager = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
  const template = `[${type}.ToastTemplateType]::ToastText01`;
  const toast = `[${type}.ToastNotification]::new($xml)`;
  return [
    `${manager} > $null`,
    `$body = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${utf8Base64(body)}'))`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
    `$xml.GetElementsByTagName('text').Item(0).AppendChild($xml.CreateTextNode($body)) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${TOAST_TITLE}').Show(${toast})`,
  ].join("\n");
}

export function createWindowsToastExtension(
  pi: ExtensionAPI,
  options: { platform?: NodeJS.Platform } = {},
): void {
  const platform = options.platform ?? process.platform;

  pi.on("agent_settled", async (_event, ctx: ExtensionContext) => {
    if (platform !== "win32" || ctx.mode !== "tui") return;

    const projectName = basename(ctx.cwd);
    const body = `${TOAST_BODY_PREFIX}${projectName}`;
    const command = buildWindowsToastCommand(body);

    try {
      await pi.exec(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { timeout: TOAST_TIMEOUT_MS },
      );
    } catch {
      // A failed Toast must not affect Pi and must not trigger a fallback.
    }
  });
}

export default function windowsToast(pi: ExtensionAPI): void {
  createWindowsToastExtension(pi);
}
