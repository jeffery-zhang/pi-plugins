# Models.dev 元数据 detect 可行性研究

**综合结论：可行。** 以 Pi 1.4+ 为目标，可以从公开 JSON 目录精确匹配已有 provider/model，再用 `modelOverrides` 补全能力、限制和已知价格。当前已用真实 API 样本通过 Pi 1.4.0 的配置加载与合并验证。思考预算、未知档位、代理别名和复杂价格无法一律自动还原；目录声明也不等同于对用户端点实测。

研究日期：2026-11-06（Asia/Shanghai）。功能目标：Pi 1.4 及以上版本；实际 Pi 配置验证由下文 Pi 专节记录。本轮是研究，不实现、不安装插件、不调用收费模型，也未读取用户模型配置或密钥。

## 已确认的需求范围

- 已在 Pi 配置模型后，运行 `/detect <provider>/<model>` 更新一个已配置模型；模型 ID 可以继续包含 `/`，命令只按第一个 `/` 分割。
- `/detect <provider>` 只更新该 provider 在 Pi 中**已经配置的模型**，不导入 Models.dev 的全量模型。
- 查询上下文、最大输出、输入模态、推理能力/深度、价格并写回 `models.json`；连接配置与现有用户设置的保留方式由 Pi 专节说明。
- Models.dev 的 provider 与 Pi 自定义 provider 名称不一定相同。没有明确来源映射的条目应报告无法精确匹配，不靠模型名猜测供应商。

## 一、Models.dev 结论

可以把 Models.dev 当作**公开元数据目录**完成绝大多数数据查询。它不是对用户当前 API 账户的能力探测；目录里存在价格缺失、0 限制、只报告推理开关而无深度的记录。应把可确认字段逐项合并，无法确定的字段保留原值并报告原因，不能把缺失价格补成免费或把 `reasoning: true` 扩展成全部深度。[S1][S2][E1]

优先用公开 v1 `api.json`：已经包含 provider 特定的上下文、输出、模态、推理选项与文本 token 价格；这个需求不需要引入官方 SDK。实验 v2 的定价和多模态更丰富，但需要解析更复杂的条件，且 endpoint 明确处在 `experimental` 下，适合作为补充研究，不应在第一版悄悄承诺完整覆盖。[S2][S3][S4]

## 二、官方接口、认证及目录结构

| 接口 | 官方用途 | 本次证据 |
| --- | --- | --- |
| `https://models.dev/api.json` | provider ID → provider → `models[modelId]`，包含供应商价格和限制 | 无 Authorization、无 API key 请求得到 HTTP 200，5,964,119 bytes，235 providers、8,937 provider-model 条目 |
| `https://models.dev/api.json?type=chat` | 上述目录按模型类型筛选 | HTTP 200，5,714,002 bytes，235 providers、8,494 条目 |
| `https://models.dev/models.json` | provider 无关的 canonical 模型事实 | 官方 README、网站说明与 server route；未额外下载整份目录 |
| `https://models.dev/catalog.json` | `{providers, models}` 合集 | 官方 README、网站说明与 server route；未额外下载整份目录 |
| `https://models.dev/experimental/v2.0/api.json` | 详细 MIME、缓存 TTL、多个 API 协议、条件价格 | 无认证 HTTP 200，10,415,645 bytes，233 providers；下载后抽查 Anthropic/OpenAI |

来源：[S1][S3][E1][E2]。公开目录中的 `env: ["OPENAI_API_KEY"]` 等字段是**调用对应模型供应商时**所用环境变量名，并非访问 Models.dev 所需凭据。[S1][S2]

`api.json` 是全目录响应，没有分页或需要对每个模型逐次请求的理由。官方 SDK 的 `providers()` 也是 GET `api.json`；服务源码的目录路由只解析 `type`，没有 provider/model 查询参数。批量 detect 应下载一次，对本地已配置模型求交集。[S3][S5]

README 泛称默认省略特殊类型，但当前源码实际只默认排除 `decision`，并未排除 image、embedding、speech 等类型；`type=chat` 明确筛选 chat。不能因为来自默认 endpoint 就断定适合 Pi 文本对话。[S6][E1]

## 三、实际 v1 schema 与字段映射基础

下面是本次快照中 `api["openai"].models["gpt-5"]` 的必要字段，省略的是无关展示字段与实验模式；价格单位均为 USD / 百万 tokens：[S1][E1]

```json
{
  "id": "gpt-5",
  "reasoning": true,
  "reasoning_options": [
    {"type": "effort", "values": ["minimal", "low", "medium", "high"]}
  ],
  "modalities": {"input": ["text", "image"], "output": ["text"]},
  "limit": {"context": 400000, "input": 272000, "output": 128000},
  "cost": {"input": 1.25, "output": 10, "cache_read": 0.125},
  "canonical_model_id": "openai/gpt-5"
}
```

| 需求 | Models.dev v1 字段 | 必须保留的语义 |
| --- | --- | --- |
| 上下文 | `limit.context` | context window；不要用 `limit.input` 替代 |
| 最大输出 | `limit.output` | 单独的输出 token 上限；0 不是可信的可用输出配置 |
| 最大输入 | `limit.input`，可选 | 若 Pi 无对应字段，不混入 context/output |
| 输入模态 | `modalities.input` | v1 取值有 text/image/audio/video/pdf；不是全部都能被 Pi 表达 |
| 推理能力 | `reasoning` | 布尔能力；不代表可调深度 |
| 推理控制 | `reasoning_options[]` | effort / toggle / budget_tokens 是不同控制机制 |
| 文本价格 | `cost.input/output/cache_read/cache_write` | 字段可缺；0 与缺失必须区分 |
| 上下文阶梯 | `cost.tiers[]` | 每档有完整价格与 `tier: {type:"context",size:N}` |

字段定义与验证约束见 [S2]，定价单位见 [S1]。API 客户端需要验证对象/数组、有限非负数字、已知枚举与正数 token 限制；未知额外字段应忽略。Schema 中 token 限制使用 `.min(0)`，并未排除 0，本次还发现 output 大于 context 的可疑记录，不宜盲写。[S2][E1]

## 四、思考深度确实有数据，但不能全量自动还原

当前 API **不是只有 `reasoning: boolean`**。官方 schema 允许：[S2]

```ts
{ type: "toggle" }
{ type: "effort", values: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "default", null] }
{ type: "budget_tokens", min?: number, max?: number }
```

上面 effort 数组展示 schema 可选值集合，不是每个模型都支持整组。本次实际 effort 值有 `none/minimal/low/medium/high/xhigh/max/default`，未找到 null 实例。Schema 要求 `reasoning: true` 必须有 `reasoning_options` 字段，却允许空数组；因此字段存在不等于深度已知。[S2][E1]

实测差异：[E1]

| provider/model | reasoning_options | 解释 |
| --- | --- | --- |
| `openai/gpt-5` | effort minimal/low/medium/high | 有明确档位；未列出 none，不应默认允许关闭推理 |
| `anthropic/claude-sonnet-4-5` | budget_tokens，min=1024 | token 预算，不是 low/medium/high 档位；未给 max |
| `google/gemini-2.5-pro` | budget_tokens，min=128,max=32768 | 有预算范围，缺少将 Pi 档位转换成预算的规则 |
| `openrouter/anthropic/claude-sonnet-4.5` | toggle | 只能确认可切换；不能从它推导所有 effort 档位 |
| `anyapi/google/gemini-2.5-pro` | 空数组 | 只能确认 reasoning=true，控制方式未知 |

`none` 与 Pi `off` 的对应、`default` 的处理、不同 API 协议是否支持该 effort 以及 Pi 自带预算映射，需要结合 Pi adapter 判断；只看 Models.dev 不能保证实际请求成功。同一个 canonical model 经不同 provider 服务时可能提供不同控制面，跨 provider 回退会写入错误设置。[S1][S2][S4][E1]

## 五、价格、阶梯、缓存和模式

v1 文本价格无需倍率换算：USD / 1,000,000 tokens。缓存字段名需要映射；缺失不等于 0，不能因来源没给 `cache_write` 就清空已有价格。[S1][S2]

本次 `google/gemini-2.5-pro` 的基础价格是 input=1.25、output=10、cache_read=0.125；超过 200,000 context 的一档为 input=2.5、output=15、cache_read=0.25，`tier.size=200000`。[E1]

v1 同时会输出遗留 `context_over_200k`，**不要拿这个字段名当精确阈值**：生成器只要存在单个阈值 `>=200000` 的 tier 就生成它；例如 `openai/gpt-5.5` 的实际 tier.size=272000 也有同名遗留字段。应始终优先解析 `cost.tiers`。[S7][E1]

v1 的主要损失：[S4]

- `gt` 与 `gte` 都归并成 `tier.size`，边界语义被压缩；需要核对 Pi tier 的比较规则。
- `cache_write` 仅保留第一个 TTL 的价格（供应商默认值）。例如 Anthropic Sonnet4.5 的 v2 缓存写价是 `5m:3.75,1h:6`，v1 只给 3.75。
- 服务档位、地区等复杂条件 overrides 和 multipliers 留在 v2，基础 `cost` 不包含它们。`experimental.modes.fast/flex` 的价格也不能混为默认价格。
- 图片按张、音视频按分钟/秒、文本按字符等价格不能无损放进每百万文本 token 的 v1 cost；web_search 费用同样留在 v2。
- v1 可有 `cost.reasoning/input_audio/output_audio`；Pi 若无对应表达，应在结果中说明未写入。

实验 v2 的价格单位是：token/character 按百万单位，其余 image/second/minute 等按单个单位；`cost.text.input.cache.write` 还能按 TTL 分表。完整复制 v2 定价将明显超出简单元数据更新器范围。[S8][E2]

## 六、匹配与 provider 批量行为

1. 以 `data[modelsDevProviderId].models[fullModelId]` 做精确匹配；保留大小写、日期后缀、冒号与模型 ID 内的 `/`。本次有 5,194 条 ID 含 `/`，所有已统计模型 key 与内部 id 一致。[E1]
2. Pi provider 是用户命名的配置键；同名命中才是天然候选。自定义代理、网关、别名没有通用反向推导方法。若要支持来源映射，必须明确是来源 provider/model 映射，不能修改 Pi 的请求 model ID。[S1][E1]
3. `canonical_model_id` 能归属到实验室基础模型，不能替代供应商条目来决定价格、上下文和推理控制。Sonnet4.5 在 Anthropic 的 context=200000、OpenRouter 的 context=1000000，前者 budget、后者 toggle。[E1]
4. 相同 base URL 也不能唯一决定目录 provider：`llmgateway` 与 `llmgateway-providers` 的 `api` 均为 `https://api.llmgateway.io/v1`，名字和目录是两项。协议兼容亦不足以证明 provider 身份。[E1]
5. 旧 ID 可完全找不到。例如本次目录没有 `deepseek/deepseek-reasoner`，仅有 deepseek-v4-flash、deepseek-flash、deepseek-v4-flash-vision-exp、deepseek-v4-pro；禁止静默把旧 ID 升级到新模型。[E1]
6. `/detect <provider>`：读取该 provider 已配置模型列表，精确查表一次后逐项生成更改/跳过结果；不存在于目录、值不可信或字段缺失只影响对应模型/字段，不新增其他模型。一次网络失败不应产生半份文件；写入策略见第九节。

## 七、字段覆盖率与缺失证据

统计对象是 2026-11-06 02:39:58 UTC 获取的默认 v1 快照中 **provider-model 条目**，不是去重基础模型。这里的“有字段”不意味着数据经过模型供应商实时验证。[E1]

| 字段/情况 | 条目数（总 8,937） |
| --- | ---: |
| `limit.context` / `limit.output` / modalities / reasoning 有字段 | 各 8,937 |
| context=0 / output=0 | 159 / 259 |
| `limit.input` 有字段 | 1,715 |
| `cost` 有字段 / 缺失 | 8,542 / 395 |
| `cost.cache_read` / `cost.cache_write` 有字段 | 6,263 / 2,002 |
| `cost.tiers` 有字段 | 821（总 889 档，全部 context） |
| 遗留 `cost.context_over_200k` | 639 |
| `cost.reasoning` / input_audio / output_audio | 150 / 204 / 24 |
| reasoning=true / 对应 options 空数组 | 6,864 / 1,136 |
| 含 effort / toggle / budget_tokens 控制 | 4,602 / 1,430 / 609（可同时出现） |
| 仅一个 toggle，未给深度或预算 | 732 |
| `canonical_model_id` 有字段 | 7,618 |
| 输入含 text / image / audio / video / pdf | 8,897 / 5,679 / 806 / 1,668 / 2,377 |

更贴近 Pi 的 `type=chat` 快照仍有 18 个 context=0、23 个 output=0、182 个缺价格、1,120 个 reasoning=true 但 options 为空、6 个输入无 text、4 个输出无 text。因此仅过滤 chat 不能代替写入前校验。[E3]

这也是社区维护数据，官方 README 直接请求贡献者帮助保持更新；本研究验证的是目录内容、schema 与转换逻辑，没有验证实际供应商、账户权限、套餐、地区、模型可用性或实时账单。[S1]

## 八、建议的最小行为与未决事项

- 固定从公开 v1 读取一次目录，给请求超时/取消，校验所需字段；不用调用模型验证元数据。
- 核心元数据可以按字段更新；空 effort、toggle 或预算不能被伪造为完整深度列表。
- 把缺价格、unsupported modality、可疑 token 值、目录未命中、未支持的定价维度放进每项结果；不把缺失当 0，不从其他 provider 推价格。
- 全部写入前准备好变更，保留现有格式/注释以及连接字段；可行写入位置见第九节。
- 来源映射策略、预算如何映射 Pi thinking levels、档位 `default` 如何表达，仍需设计取舍；纯精确匹配版本可以先跳过不能确定的项目。
- `context_over_200k` 不应成为映射入口；阶梯覆盖、旧阶梯清理与缺缓存价格如何继承，需要按 Pi 的 merge 和 tier 结算语义处理。

## 原始来源

上游源码固定到本次读取的 dev tree `c2983206adf2b2d18d279031ad134c23f2832c83`。在线 API 是当前快照，不等同于该 commit 的确定性构建产物。

- [S1] [Models.dev 官方 README：API、provider/model ID、v2 作者格式、v1字段/价格单位](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/README.md)；[官方网站](https://models.dev/)。
- [S2] [v1 schema：ReasoningOption、Cost、CostTier、Model、Provider](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/packages/core/src/schema.ts#L25)。reasoning_options 必填/空数组约束见同文件 L312 起；limit 的 `.min(0)` 见 L161 起。
- [S3] [web server routes / catalogResponse](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/packages/web/src/server.ts#L114)；[静态 API 生成](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/packages/web/script/build.ts#L86)。
- [S4] [v2→v1：reasoning options、token cost、tier、缓存 TTL、mode](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/packages/core/src/translate.ts#L266)。
- [S5] [官方 SDK：providers() 请求及 signal](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/packages/sdk/src/client.ts#L35)。
- [S6] [type 筛选器：default 只排除 decision](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/packages/core/src/filter.ts#L44)。
- [S7] [context_over_200k 兼容字段生成](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/packages/core/src/generate.ts#L309)。
- [S8] [v2 schema：ReasoningSupport、缓存、CostUnit、条件价格](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/packages/core/src/schema-v2.ts#L136)；[OpenAI GPT-5 provider 数据](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/providers/openai/models/gpt-5.toml)；[Anthropic Sonnet4.5 provider 数据](https://github.com/anomalyco/models.dev/blob/c2983206adf2b2d18d279031ad134c23f2832c83/providers/anthropic/models/claude-sonnet-4-5.toml)。

## 抓取证据与可复用临时快照

临时目录：[pi-models-dev-detect-20261106](C:/Users/0116/AppData/Local/Temp/pi-models-dev-detect-20261106)。原始网页、schema、生成器源码、repo tree、API JSON 与统计均在此目录，未加入仓库。只下载公开资源，无模型调用。

- [E1] [api.json 快照](C:/Users/0116/AppData/Local/Temp/pi-models-dev-detect-20261106/api.json)，原 URL [api.json](https://models.dev/api.json)，HTTP 200；响应日期 `Fri, 06 Nov 2026 02:39:58 GMT`，Content-Type=`application/json`，Cache-Control=`public, must-revalidate, max-age=0`，ETag=`W/"ef439e18f6a6def5c3ea2b7a543243ae"`；文件 SHA256=`EF439E18F6A6DEF5C3EA2B7A543243AE30A070522A072B759E95964A02B18A1E`。派生 [coverage.json](C:/Users/0116/AppData/Local/Temp/pi-models-dev-detect-20261106/coverage.json)、[examples.json](C:/Users/0116/AppData/Local/Temp/pi-models-dev-detect-20261106/examples.json)。
- [E2] [v2-api.json 快照](C:/Users/0116/AppData/Local/Temp/pi-models-dev-detect-20261106/v2-api.json)，原 URL [experimental/v2.0/api.json](https://models.dev/experimental/v2.0/api.json)，HTTP 200，SHA256=`F28E946033A9A8EEAD58A6E8EB747728075ADF08185F514892304BC6710C5A90`。v2 比 v1 少 `google-vertex-anthropic`、`azure-cognitive-services` 两个 provider，本轮未追查原因，不能假定换 endpoint 无行为差异。
- [E3] [chat-api.json 快照](C:/Users/0116/AppData/Local/Temp/pi-models-dev-detect-20261106/chat-api.json)，原 URL [api.json?type=chat](https://models.dev/api.json?type=chat)，HTTP 200，SHA256=`EC573B2F239D998149B2DF389BAF2EF5F35D67957162A71D61687394EBCA8F46`。

## 九、Pi 1.4+ 配置与运行时验证

### 用户已确定的范围

- 目标兼容范围为 **Pi 1.4+**；本次实际验证版本为 **1.4.0**，不据此承诺未测试的未来版本。
- `/detect <provider>/<model>` 只更新指定的已有模型；`/detect <provider>` 更新该 provider 在 Pi 中已配置的模型，不导入 models.dev 的全量模型。
- 本轮只探索可行性，不实现或安装插件，不修改用户模型配置。

### 配置位置与现成功能

Pi 将 provider、模型定义与覆盖集中放在 `<agent-dir>/models.json`，不是每个模型一份文件。默认 agent directory 是 `~/.pi/agent`，可以通过 `PI_CODING_AGENT_DIR` 改变；实现应使用 Pi 的路径接口，而不是写死用户目录。[Pi 配置文档](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md:9)、[getModelsPath](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/config.js:503)

Pi 1.4.0 的内置目录已有 pi.dev 在线目录覆盖和离线缓存，`pi update --models` 可强制更新目录。因此本需求的主要价值是：补全 `models.json` 中已有的自定义模型、按 provider/model 选定更新，以及把声明参数显式保存到配置文件。现有目录刷新并不等于把自定义配置更新为 models.dev 元数据。[Pi 模型文档](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:15)、[远端目录实现](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/remote-catalog-provider.js:66)

### 字段如何落到 Pi

| models.dev | Pi 字段 | 写入约束 |
|---|---|---|
| `limit.context` | `contextWindow` | 只接受有限正整数；0 不代表应配置为零 |
| `limit.output` | `maxTokens` | 同上；它是输出上限，不是上下文大小 |
| `limit.input` | 无独立对应字段 | 可以展示，不能冒充 `contextWindow` |
| `modalities.input` | `input` | Pi 模型配置只接受 `text`、`image`；取交集为空则跳过，不写空数组 |
| `reasoning` | `reasoning` | 仅在源有明确布尔值时更新 |
| `reasoning_options[type=effort].values` | `thinkingLevelMap` | 按 Pi 的七个级别构建完整映射；不支持的级别写 `null`，不要只省略 |
| `reasoning_options[type=toggle/budget_tokens]` | 无通用的固定档位对应 | 可以确定模式，但不能凭空推导 `low/medium/high`；保留既有映射并报告 |
| `cost.input/output/cache_read/cache_write` | `cost.input/output/cacheRead/cacheWrite` | 单位都是 USD/百万 tokens；逐项更新明确值，缺失项不填 0 |
| `cost.tiers[].tier={type:context,size:N}` | `cost.tiers[].inputTokensAbove=N` | Pi 的阶梯项要求四种价格齐全；仅在阈值语义和价格字段都可确定时转换 |

Pi 字段依据：[配置参考](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md:26)、[模型 schema](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/providers/model-schema.js:1)。源字段依据本文前半部分的 models.dev API/schema 研究。

`thinkingLevelMap` 的省略与 `null` 不等价：`reasoning: true` 时，Pi 默认开放 `off/minimal/low/medium/high`，只有 `xhigh/max` 默认关闭。因此如果源只声明四个 effort，只写那四项会错误保留 `off`；完整映射应明确禁止源未支持的级别。`none` 可在对应 API 支持时映射到 Pi 的 `off`，而 provider 的预算/开关机制需要分别处理。[支持档位计算](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/models.js:693)、[Responses 的 off 值](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js:290)

### 建议通过 modelOverrides 保存元数据

建议把发现到的能力、限制和价格写入 `providers[provider].modelOverrides[modelId]`，保留原来的 `models` 定义。Pi 1.4.0 的真实合并顺序是在自定义 `models`、扩展模型及 OAuth 投影后应用 `modelOverrides`，所以这种方式对已有自定义模型也生效。`cost` 按字段合并，适合源缺少部分缓存价格的情况；未知模型 ID 的覆盖会被忽略，因此写入前必须验证目标模型确实存在。[顶层覆盖实现](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js:354)、[逐项合并](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js:53)、[覆盖参考](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models-configuration.md:59)

`models[].cost` 要求 input/output/cacheRead/cacheWrite 四项齐全；`modelOverrides.cost` 允许部分字段。源缺少 cache_write 时，直接把不完整的 cost 放进完整模型定义会导致 schema 错误；使用部分覆盖可保留本地原值。若本地也未知，报告未知，不能声称 Pi 显示的默认零成本是真实免费。[实际 schema](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/model-config.js:34)、[默认成本](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js:107)

只补全元数据，不从目录替换 `id/api/baseUrl/apiKey/headers/authHeader/compat`、用户显示名称或采样配置；这些字段由连接配置和端点实际协议决定。特别是 `reasoning_options` 描述可用控制，不足以证明任意 OpenAI 兼容代理都接受同样的请求体。[Pi 兼容性说明](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/models.md:155)

### 最小调用与处理流程

以下是**待实现入口示意**，当前仓库尚无 detect 命令：

```text
/detect openai/gpt-5
/detect openai
```

用户已确定仅提供 Pi 内的 `/detect` 斜杠命令，通过 `registerCommand("detect", ...)` 注册。入口方案不再包含启动 flag、独立 CLI 或 `pi detect ...` 包装器；不限定 print 模式，也不注册模型工具。[Pi 扩展命令](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:177)

建议处理流程：

1. 读取本地配置确定已有目标；按第一个 `/` 拆 provider 与剩余完整 model ID，保留 `openrouter/anthropic/...` 等多层模型 ID。
2. 拉取一次公共目录，按 provider + model ID 精确匹配。自定义 provider 名、路由别名或日期别名无法精确对应时，需要显式来源映射；不给模糊候选自动写入权限。
3. 校验只读目录中的字段，生成 metadata patch，报告每个模型的匹配、变更和缺失项；未知值保留本地设置。
4. 完成验证后，备份目标文件，在同目录准备临时文件并原子替换；发布前检查文件未被其他进程改动。日志只输出元数据差异，不输出整个含凭据配置的文件。
5. 等待 `ctx.modelRegistry.refresh()` 并检查错误；当前已选模型在正在运行的会话中如何重绑，需要实现阶段另外验证。在当前 Pi 会话中执行 `/detect` 后，需要验证注册表刷新与当前模型参数的应用。[刷新接口](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:24)

Pi 1.4.0 读取配置时支持 BOM 与 JSON 注释。写入器必须明确保留或妥善处理这些输入，不能用普通 JSON.parse/JSON.stringify 默默删除注释；只在内存中对公开元数据做转换，不执行 `apiKey: "!command"` 或 Header 中的命令来“探测”。[配置加载逻辑](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/model-config.js:117)

### 本轮实际验证

使用今日 `https://models.dev/api.json` 中的 `openai/gpt-5`，在系统临时目录创建带 BOM/注释、假连接地址和未解析环境变量引用的配置，然后调用本机 Pi 1.4.0 的 **ModelConfig.load + composeModelProvider**。未加载用户配置，也未调用任何模型端点。

已通过的检查：

- 真实 schema 接受上下文 400000、最大输出 128000、text/image、reasoning 和完整 effort 映射。
- 自定义 `models` 条目确实接受 `modelOverrides` 中的 metadata patch。
- 只覆盖 input/output/cacheRead 时，既有 cacheWrite 保持不变。
- 用户显示名称、baseUrl、环境变量引用和模型数量保持不变。
- 完整模型定义中的缺项 cost 被 Pi schema 拒绝。

可复跑脚本：[pi-config-check.mjs](C:/Users/0116/AppData/Local/Temp/pi-models-dev-detect-20261106/pi-config-check.mjs)；结果：[pi-verification.json](C:/Users/0116/AppData/Local/Temp/pi-models-dev-detect-20261106/pi-verification.json)。脚本额外跑过仓库现有 0.84.3 依赖，均通过，但目标兼容范围仍按用户要求定为 **1.4+**。

**验证边界：** 已证明目录字段可转换并被当前 Pi 真实配置合并逻辑接受；尚未实现 detect 命令、写入器、来源映射和会话内模型重绑，也未实测 provider 端点的上下文容量、图片能力、思考控制或实际账单。models.dev 提供的是目录声明值，不是当前连接的能力实测结果。


## 十、本机远端接口实请求验证

验证时间：2026-11-06 11:14:15（Asia/Shanghai）。使用 Windows 上的 Node.js v24.12.0 原生 fetch，未发送 Authorization 或 API key；两个独立请求并行执行。验证脚本逐项校验 HTTP 状态、JSON Content-Type、JSON 解析、目录结构、模型 key/id 一致、样本 token 上限、输入模态、reasoning 布尔值及已提供价格数值；最后交叉比较两个接口的五个样本字段。

| 接口 | HTTP | 响应大小 | 耗时 | Providers | Provider-model 条目 |
|---|---:|---:|---:|---:|---:|
| https://models.dev/api.json | 200 | 5,964,119 bytes | 2692 ms | 235 | 8,937 |
| https://models.dev/api.json?type=chat | 200 | 5,714,002 bytes | 2660 ms | 235 | 8,494 |

两个接口所有目录条目的模型 key/id 均一致。以下五个样本的 limit、modalities、reasoning、reasoning_options、cost 在全量和 chat 接口中逐项相等：

| 精确目标 | Context | 最大输出 | 思考控制 | 输入/输出价格，USD/百万 tokens |
|---|---:|---:|---|---|
| openai/gpt-5 | 400000 | 128000 | effort: minimal/low/medium/high | 1.25 / 10 |
| openai/gpt-4o-mini | 128000 | 16384 | reasoning=false，无 options | 0.15 / 0.6 |
| anthropic/claude-sonnet-4-5 | 200000 | 64000 | budget_tokens: min=1024 | 3 / 15 |
| google/gemini-2.5-pro | 1048576 | 65536 | budget_tokens: min=128,max=32768 | 1.25 / 10（另有阶梯） |
| openrouter/anthropic/claude-sonnet-4.5 | 1000000 | 64000 | toggle | 3 / 15（另有阶梯） |

这些样本均能读取 text/image 输入能力；部分还声明 pdf/audio/video，不能直接全量写入 Pi 的 text/image input 枚举。价格字段也有预期缺项，例如 GPT-5 没有 cache_write，实际取值必须保持 unknown，而不是转成零。

chat 响应中仍有 18 个 context 不是正整数、23 个 output 不是正整数、182 条缺 cost、1120 条 reasoning=true 但 options 为空。因此“请求与读取成功”不代表所有目录字段均可直接写入。fetch 样本读取断言与跨接口比较全部通过，本次未调用模型供应商接口或更改用户配置。

本轮全量响应 SHA256=ef439e18f6a6def5c3ea2b7a543243ae30a070522a072b759e95964a02b18a1e；chat 响应 SHA256=ec573b2f239d998149b2df389baf2ef5f35d67957162a71d61687394ebca8f46。两者与前次研究快照一致。

**结论：远端接口在本机可以正常获取和解析所需元数据，足够作为 /detect 的数据输入。** 完整性校验、来源映射及 Pi 配置写入仍属于后续实现；本轮没有验证供应商真实端点或实际账单。

验证材料：[可复跑脚本](C:/Users/0116/AppData/Local/Temp/pi-models-dev-live-check-9369ebb24c0842eb96796366cf9170b5/verify.mjs)、[完整结果](C:/Users/0116/AppData/Local/Temp/pi-models-dev-live-check-9369ebb24c0842eb96796366cf9170b5/verification.json)、[全量响应](C:/Users/0116/AppData/Local/Temp/pi-models-dev-live-check-9369ebb24c0842eb96796366cf9170b5/all.json)、[chat 响应](C:/Users/0116/AppData/Local/Temp/pi-models-dev-live-check-9369ebb24c0842eb96796366cf9170b5/chat.json)。


## 十一、当前会话元数据刷新边界

静态核查 Pi 1.4.0：ctx.modelRegistry.refresh 只调用 runtime.refresh，重载配置并重建 provider/registry snapshot，不回写当前会话的 Model 对象。[registry](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js:11)、[runtime](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js:590)。session.model 返回 agent.state.model，当前 ctx.model 同样读取该对象；models.json/override 的新参数以新 Model 对象构造，旧引用仍旧。[session getter](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:1051)、[模型合并](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js:54)

公开 pi.setModel(model) 可以重新选择同 provider/id 的模型并替换当前对象；成功时会追加 model_change，会重新按每模型设置/全局默认/当前值选择 thinkingLevel 并依新模型能力钳制，只有实际变化才发 thinking-level 事件。同 ID 重选不触发 model_select。[公开调用](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2805)、[重选和会话记录](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2008)、[思考级别重算](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2114)

scopedModels 保存模型对象；scoped cycling 仅用新 available IDs 筛选旧集合，仍可选择旧 next.model。因此仅 refresh 再重选当前模型也不能承诺所有切换路径都获得新元数据。[scoped cycling](C:/Users/0116/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2052)

refresh 与 pi.setModel 均不自动等待 idle；扩展斜杠命令允许在 streaming 时立即执行。当前只完成静态核查，没有实测流式中换模型、热重绑或特殊 provider 的原地修改行为。首版保证重启生效，还是实现当前会话热更新，留给 P0 访谈决定。
