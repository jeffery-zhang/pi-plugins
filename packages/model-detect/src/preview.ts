import { Key, matchesKey, SelectList, Text } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export async function choose(ctx: ExtensionCommandContext, labels: string[], signal: AbortSignal): Promise<string | undefined> {
  const title = "选择唯一来源（原厂价请选择原厂 provider）";
  if (ctx.mode !== "tui") return ctx.ui.select(title, labels, { signal });
  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
    const accent = (text: string) => theme.fg("accent", text);
    const list = new SelectList(labels.map(label => ({ value: label, label })), Math.max(1, Math.min(8, tui.terminal.rows - 8)), {
      selectedPrefix: accent, selectedText: accent, description: text => text, scrollInfo: text => text, noMatch: text => text,
    });
    list.onSelect = item => done(item.value); list.onCancel = () => done(undefined);
    const abort = () => done(undefined);
    signal.addEventListener("abort", abort, { once: true });
    return {
      render: (width: number) => [...new Text(title, 0, 0).render(width), "", ...list.render(width), "", ...new Text("↑↓ 选择 · Enter 确定来源 · Esc 取消", 0, 0).render(width)],
      handleInput(data: string) { list.handleInput(data); tui.requestRender(); },
      invalidate() { list.invalidate(); },
      dispose() { signal.removeEventListener("abort", abort); },
    };
  }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } });
}

export async function confirm(ctx: ExtensionCommandContext, message: string, signal: AbortSignal): Promise<boolean> {
  if (ctx.mode !== "tui") return ctx.ui.confirm("Model Detect：确认本次全部差异", message, { signal });
  // Native confirm has no scrolling; a batch diff must remain fully inspectable.
  return ctx.ui.custom<boolean>((tui, theme, _keys, done) => {
    const text = new Text(message, 0, 0);
    let offset = 0, height = 1, length = 0;
    const abort = () => done(false);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) done(false);
    return {
      render(width: number) {
        const lines = text.render(width);
        length = lines.length;
        const heading = new Text(theme.fg("accent", "Model Detect：预览全部差异"), 0, 0).render(width);
        const footer = (start: number, end: number) => new Text(`第 ${start}–${end} / ${length} 行 · ↑↓ / PgUp PgDn 滚动 · Enter 确认写入 · Esc 取消`, 0, 0).render(width);
        height = Math.max(1, tui.terminal.rows - heading.length - footer(length, length).length - 2);
        offset = Math.max(0, Math.min(offset, length - height));
        return [...heading, "", ...lines.slice(offset, offset + height), "", ...footer(offset + 1, Math.min(length, offset + height))];
      },
      handleInput(data: string) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) done(false);
        else if (matchesKey(data, Key.enter)) done(true);
        else {
          if (matchesKey(data, Key.up)) offset--;
          if (matchesKey(data, Key.down)) offset++;
          if (matchesKey(data, Key.pageUp)) offset -= height;
          if (matchesKey(data, Key.pageDown)) offset += height;
          if (matchesKey(data, Key.home)) offset = 0;
          if (matchesKey(data, Key.end)) offset = length;
          tui.requestRender();
        }
      },
      invalidate() { text.invalidate(); },
      dispose() { signal.removeEventListener("abort", abort); },
    };
  }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } });
}
