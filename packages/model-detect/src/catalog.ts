import { isDeepStrictEqual } from "node:util";

export type RecordValue = Record<string, unknown>;
export function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function visible(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const price = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const priceFields = { input: "input", output: "output", cache_read: "cacheRead", cache_write: "cacheWrite" };

export interface Entry { key: string; id: string; name: string; data: RecordValue }

export async function catalog(url: string, signal: AbortSignal): Promise<Entry[]> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`目录请求失败（HTTP ${response.status}）。`); }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel(); throw new Error("目录返回的不是 JSON。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("目录响应为空。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 20 * 1024 * 1024) throw new Error("目录超过 20 MiB，已停止读取。");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new Error("目录不是有效 UTF-8 JSON。"); }
  if (!record(parsed)) throw new Error("目录结构无效。");
  const entries: Entry[] = [];
  for (const [provider, definition] of Object.entries(parsed)) {
    if (!provider || visible(provider) !== provider || !record(definition) || !record(definition.models)) continue;
    for (const [id, data] of Object.entries(definition.models)) {
      if (!id || visible(id) !== id || !record(data) || data.id !== id || (data.type !== undefined && data.type !== "chat")) continue;
      if (record(data.modalities) && Array.isArray(data.modalities.output) && !data.modalities.output.includes("text")) continue;
      entries.push({ key: `${provider}/${id}`, id, name: typeof data.name === "string" ? visible(data.name) : id, data });
    }
  }
  if (!entries.length) throw new Error("目录没有可用的聊天模型条目。");
  return entries;
}

export function metadata(entry: Entry, current: RecordValue): { patch: RecordValue; warnings: string[] } {
  const source = entry.data;
  const patch: RecordValue = {};
  const warnings: string[] = [];
  const limits = record(source.limit) ? source.limit : {};
  for (const [sourceKey, target] of [["context", "contextWindow"], ["output", "maxTokens"]]) {
    if (positive(limits[sourceKey])) patch[target!] = limits[sourceKey];
    else warnings.push(`${target} 缺失或无效，保留原值`);
  }
  const context = patch.contextWindow ?? current.contextWindow;
  const output = patch.maxTokens ?? current.maxTokens;
  if (positive(context) && positive(output) && output > context) {
    delete patch.contextWindow; delete patch.maxTokens;
    warnings.push("上下文与输出上限不一致，保留原限制");
  }
  const inputs = record(source.modalities) ? source.modalities.input : undefined;
  if (Array.isArray(inputs) && inputs.every(value => typeof value === "string")) {
    const supported = [...new Set(inputs.filter(value => value === "text" || value === "image"))];
    if (supported.length) patch.input = supported;
    else warnings.push("没有 Pi 可表达的输入模态，保留原值");
    const ignored = inputs.filter(value => value !== "text" && value !== "image");
    if (ignored.length) warnings.push(`输入模态 ${ignored.join("/")} 未写入 Pi`);
  } else warnings.push("输入模态缺失或无效，保留原值");

  if (source.reasoning === false) patch.reasoning = false;
  else if (source.reasoning === true) {
    const options = Array.isArray(source.reasoning_options) ? source.reasoning_options : [];
    const effort = options.filter(option => record(option) && option.type === "effort");
    const values = effort.length === 1 && record(effort[0]) ? effort[0].values : undefined;
    if (Array.isArray(values) && values.length && values.every(value => typeof value === "string" && ["none", ...levels.slice(1)].includes(value))) {
      patch.reasoning = true;
      patch.thinkingLevelMap = Object.fromEntries(levels.map(level => {
        const value = level === "off" ? "none" : level;
        return [level, values.includes(value) ? value : null];
      }));
    } else warnings.push("思考控制不能准确转换，保留整个思考组");
  } else warnings.push("思考能力未知，保留整个思考组");

  if (record(source.cost)) {
    const cost: RecordValue = {};
    const ignored = Object.keys(source.cost).filter(key => ![...Object.keys(priceFields), "tiers", "context_over_200k"].includes(key));
    if (ignored.length) warnings.push(`其他计费维度 ${ignored.join("/")} 未写入 Pi`);
    for (const [sourceKey, target] of Object.entries(priceFields)) {
      if (price(source.cost[sourceKey])) cost[target] = source.cost[sourceKey];
      else warnings.push(`价格 ${target} 未知，保留原值（不代表免费）`);
    }
    const oldCost = record(current.cost) ? current.cost : {};
    const sourceTiers = source.cost.tiers;
    const hasOldTiers = Array.isArray(oldCost.tiers) && oldCost.tiers.length > 0;
    let valid = true;
    if (sourceTiers !== undefined) {
      const tiers: RecordValue[] = [];
      if (!Array.isArray(sourceTiers) || Object.keys(cost).length !== 4) valid = false;
      else for (const item of sourceTiers) {
        if (!record(item) || !record(item.tier) || item.tier.type !== "context" || !positive(item.tier.size) ||
          !Object.keys(priceFields).every(key => price(item[key]))) { valid = false; break; }
        tiers.push({ inputTokensAbove: item.tier.size, ...Object.fromEntries(Object.entries(priceFields).map(([key, value]) => [value, item[key]])) });
      }
      if (new Set(tiers.map(tier => tier.inputTokensAbove)).size !== tiers.length) valid = false;
      if (valid) cost.tiers = tiers.sort((a, b) => Number(a.inputTokensAbove) - Number(b.inputTokensAbove));
    } else if (hasOldTiers) valid = false;
    if (!valid) warnings.push("阶梯价格无法完整转换，保留整个价格组");
    else if (Object.keys(cost).length) patch.cost = cost;
  } else warnings.push("价格未知，保留整个价格组");

  for (const [key, value] of Object.entries(patch)) {
    if (record(value)) {
      const previous = record(current[key]) ? current[key] : {};
      const changes = Object.fromEntries(Object.entries(value).filter(([field, next]) => !isDeepStrictEqual(previous[field], next)));
      if (Object.keys(changes).length) patch[key] = changes;
      else delete patch[key];
    } else if (isDeepStrictEqual(current[key], value)) delete patch[key];
  }
  return { patch, warnings };
}
