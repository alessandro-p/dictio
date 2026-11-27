# WebLLM feasibility for suggesting entries

Research for issue #22. Question: can WebLLM run in the browser well enough to
suggest translations and example sentences for a term in a chosen language
pair, given the standing constraints in #19 (user content never leaves the
browser, static asset fetches such as model weights are allowed, AI disabled on
phones, Vercel Hobby)?

Sources were read on 2026-11-27. WebLLM facts are from `mlc-ai/web-llm` at
v0.2.89 (released 2026-11-17), whose prebuilt model libraries are
`v0_2_87/base`.

## Short answer

Yes, on desktop and laptop browsers with WebGPU, using a 1–2B parameter model
of roughly 0.6–1.1 GB. The download is the main cost. Self-hosting the weights
on Vercel Hobby works on paper, but the 100 GB/month transfer allowance only
covers about 100 first-time model downloads, and going over pauses the account
for 30 days. Suggestion quality for small models varies by language and has to
be checked against the chosen language list.

## 1. WebGPU support

WebLLM requires WebGPU. When no adapter is found it throws
`WebGPUNotAvailableError` ([engine.ts][engine]).

| Browser               | WebGPU by default                                                                                                    | Source                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Chrome / Edge desktop | Since 113 on Windows, macOS, ChromeOS. Linux since 144, Intel Gen12+ GPUs only                                       | [MDN BCD][bcd]             |
| Chrome Android        | Since 121                                                                                                            | [MDN BCD][bcd]             |
| Safari macOS / iOS    | Since 26. caniuse marks desktop Safari partial: on by default only on macOS 26 Tahoe or later                        | [MDN][bcd], [caniuse][ciu] |
| Firefox desktop       | Partial since 141: Windows since 141, Apple Silicon macOS since 145/147. No Intel Macs, no Linux, no service workers | [MDN BCD][bcd]             |
| Firefox Android       | No                                                                                                                   | [MDN BCD][bcd]             |

caniuse puts global support at about 87% full plus 3% partial ([caniuse][ciu]).
So **WebGPU is now common on phones** (iOS 26 Safari, Android Chrome). It cannot
double as the "disable on phones" gate; that needs a separate check (§6).

## 2. Candidate models

These are from WebLLM's built-in `prebuiltAppConfig` ([config.ts][config]).
Download size is the sum of the files in each model's Hugging Face repo
(queried through the Hugging Face API). The compiled WebGPU library (`.wasm`)
adds about 6.6 MB per model. "Low-res" is WebLLM's own `low_resource_required`
flag.

| Model (q4f16_1)       | Download | VRAM (WebLLM) | Low-res | Language claim (model card)                                                                                |
| --------------------- | -------- | ------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| Qwen3-0.6B            | 352 MB   | 1.40 GB       | yes     | Qwen3: "100+ languages and dialects", including translation ([card][qwen3])                                |
| gemma3-1b-it          | 602 MB   | 0.71 GB       | yes     | Gemma 3 family is multilingual, but the 1B's multilingual scores are far below the 4B's ([report][gemma3]) |
| LFM2.5-1.2B-Instruct  | 663 MB   | 1.00 GB       | yes     | No language claim found on the card                                                                        |
| Llama-3.2-1B-Instruct | 705 MB   | 0.88 GB       | yes     | 8 official languages: en, de, fr, it, pt, hi, es, th ([card][llama32])                                     |
| Qwen2.5-1.5B-Instruct | 880 MB   | 1.63 GB       | yes     | (older Qwen generation)                                                                                    |
| Qwen3-1.7B            | 984 MB   | 2.04 GB       | yes     | "100+ languages and dialects" ([card][qwen3])                                                              |
| Qwen3.5-2B            | 1.08 GB  | 2.25 GB       | no      | "201 languages and dialects"; reports WMT24++ across 55 languages ([card][qwen35])                         |
| Llama-3.2-3B-Instruct | 1.82 GB  | 2.26 GB       | yes     | Same 8 languages ([card][llama32])                                                                         |
| Qwen3-4B              | 2.28 GB  | 3.43 GB       | yes     | "100+ languages" ([card][qwen3])                                                                           |
| Qwen3.5-4B            | 2.39 GB  | 3.87 GB       | no      | "201 languages" ([card][qwen35])                                                                           |
| gemma-4-E2B-it        | 2.83 GB  | 3.39 GB       | no      | "35+ languages" out of the box, pre-trained on 140+ ([card][gemma4]); needs `shader-f16`                   |

Every model also has a `q4f32_1` variant, which is larger but does not need
the `shader-f16` GPU feature.

What the sources don't settle: none of them measure translation or
example-sentence quality for these 4-bit quantized builds at 1–2B parameters,
per language. Vendor claims ("100+ languages") describe the model family, not
the smallest quantized member. Gemma 3's own report shows the 1B well behind the
4B on multilingual benchmarks (MGSM 2.0 against 34.7) ([report][gemma3]).

WebLLM can enforce output structure. `response_format: { type: "json_object",
schema }` constrains decoding to a JSON schema. The prompt must still ask for
JSON, or the model may stream whitespace until it hits `max_tokens`
([chat_completion.ts][cc]). Qwen3/3.5 have a thinking mode. WebLLM exposes
`enable_thinking`, and it should be off for short suggestions.

## 3. First-load and per-suggestion time

**Primary benchmark.** The WebLLM paper measured decode speed on an M3 Max
MacBook Pro in Chrome. Llama-3.1-8B ran at 41.1 tok/s and Phi-3.5-mini (3.8B) at
71.1 tok/s, up to about 80% of native MLC speed ([paper][paper]). No primary
source benchmarks 1–2B models or integrated/low-end GPUs.

**First load** is mostly download time. The figures below are arithmetic, not
measurements:

| Download             | 50 Mbit/s | 200 Mbit/s |
| -------------------- | --------- | ---------- |
| ~0.6 GB (Gemma 3 1B) | ~1.6 min  | ~25 s      |
| ~1.0 GB (Qwen3 1.7B) | ~2.7 min  | ~40 s      |
| ~2.3 GB (Qwen3 4B)   | ~6 min    | ~1.5 min   |

GPU initialization and shader compilation come on top of that. Later visits
load from the browser cache, so there is no network cost, only local read and
GPU upload time. `initProgressCallback` reports progress for a loading UI
([API reference][api]).

**Per suggestion.** A suggestion is short: about 100–200 prompt tokens and
about 50–150 output tokens of JSON. Smaller models decode faster than the
paper's 3.8B figure, so a 1–2B model should take a few seconds on Apple Silicon
or a discrete GPU. On weak integrated GPUs it could take noticeably longer.
This is an estimate. A prototype should measure it: WebLLM returns
`usage.extra.prefill_tokens_per_s`, `decode_tokens_per_s` and
`time_to_first_token_s` with each completion ([chat_completion.ts][cc]).
Running the engine in a Web Worker (`CreateWebWorkerMLCEngine`) keeps the UI
responsive ([API reference][api]).

## 4. Serving the weights from our Vercel Hobby deployment

WebLLM accepts any URL for weights (`model`) and for the compiled library
(`model_lib`) through `appConfig.model_list`, so self-hosting is supported
([README][readme]). If the URL lacks a `/resolve/<rev>/` segment, WebLLM
appends `resolve/main/` ([support.ts][support]). Self-hosted files must
therefore sit under a path like `/models/<id>/resolve/main/`. Model records
also accept an `integrity` (SRI) field to verify downloaded files
([README][readme]).

By default, weights come from `huggingface.co/mlc-ai/*` and libraries from
`raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs`. Both are static fetches,
which #19 allows.

Vercel Hobby limits that apply:

- **Transfer:** 100 GB Fast Data Transfer per month ([Hobby plan][hobby]). That
  is about 164 first-time downloads of Gemma 3 1B, about 100 of Qwen3-1.7B, or
  about 43 of Qwen3-4B. The app's own traffic counts against the same 100 GB.
- **Overage:** "if you exceed your usage limits on the Hobby plan, you will
  have to wait until 30 days have passed before you can use the feature again"
  ([Hobby plan][hobby]). The Terms also allow immediate termination for
  exceeding limits, §19.1 ([terms][terms]). Running out of transfer would likely
  take the whole site down, not just the AI. That is our inference from the
  wording, not stated outright.
- **Usage:** Hobby is "for your personal or non-commercial use" only, §4
  ([terms][terms]).
- **Getting files into a deployment:**
  - CLI deploys cap uploaded source at 100 MB on Hobby ([limits][limits]), so
    the weights can't go up through the CLI.
  - A Git deploy would need the weights committed. GitHub blocks files over
    100 MiB without LFS ([GitHub][ghlarge]), and several shards are larger:
    the biggest file is 151 MB in gemma3-1b and 156 MB in Qwen3-1.7B. Vercel can
    pull LFS objects ([git settings][gitsettings]), but GitHub Free includes
    only 10 GiB LFS storage and 10 GiB bandwidth ([GitHub LFS][lfs]). The
    repository should also ideally stay under 1 GB ([GitHub][ghlarge]).
  - The workable route is to download the weights from Hugging Face during the
    build into `public/`. Vercel documents no cap on build output size; the
    limits are 64 GB build disk and 45 minutes build time ([limits][limits]).
    A test deploy should confirm this.
- **Caching:** static files are cached on Vercel's CDN for the life of the
  deployment ([CDN cache][cdn]). The 10 MB maximum cacheable response size is
  listed for Function responses ([CDN cache][cdn]).

## 5. Caching the weights in the browser

WebLLM caches weights and libraries automatically. `appConfig.cacheBackend`
selects the store: `"cache"` (Cache API, the default), `"indexeddb"`, `"opfs"`,
or an experimental cross-origin extension ([cache example][cacheex],
[advanced usage][adv]). The helpers `hasModelInCache`,
`deleteModelAllInfoInCache`, `deleteModelInCache` and `deleteModelWasmInCache`
support a "downloaded / remove model" UI ([cache_util.ts][cacheutil]).

Browser quotas ([MDN][quota]):

- Chromium: up to 60% of disk.
- Firefox: the smaller of 10% of disk or 10 GiB best-effort, more if
  persistent.
- Safari 17+: about 60% of disk.

A 1 GB model fits comfortably in all three.

There is a cross-concern with the user's data. Eviction is per origin and
all-or-nothing: under storage pressure the browser deletes the
least-recently-used origin's data in full, IndexedDB and Cache API together.
Origins granted `navigator.storage.persist()` are skipped. Safari deletes
script-written storage for sites not interacted with in 7 days when tracking
prevention is on ([MDN][quota]). A large model in the same origin makes dictio
a bigger eviction target, and eviction would take the glossaries with it.

Privacy check: the network calls in WebLLM's own `src/` are fetches of model
artifacts only (`engine.ts`, `support.ts`), with no telemetry
([repo src][src]). Inference runs locally, so prompts stay in the browser. This
does not audit the bundled `tvmjs` runtime.

## 6. Detecting where the AI should be off

There are two separate gates.

**Phone gate (product rule from #19).** WebGPU exists on phones, so it cannot
be the check. Candidates:

- `navigator.userAgentData.mobile`: Chromium 90+ only, not in Firefox or Safari
  ([MDN BCD][uad]).
- Media queries `(pointer: coarse)` and `(hover: none)`.
- User-agent parsing as a fallback for iOS and Android.

iPadOS Safari reports a desktop user agent, so tablets need an explicit
decision.

**Capability gate.** Run these checks before offering the feature:

1. `'gpu' in navigator` and `await navigator.gpu.requestAdapter()` returns
   non-null.
2. `adapter.features.has('shader-f16')`. If not, choose the `q4f32` variant.
   WebLLM throws `ShaderF16SupportError` or `FeatureSupportError` when a
   model's `required_features` are missing ([engine.ts][engine]).
3. `adapter.limits.maxStorageBufferBindingSize` is at least the model's
   `buffer_size_required_bytes`, where that field is set ([config.ts][config]).
4. `navigator.storage.estimate()` leaves room for the download ([MDN][quota]).

Then handle load-time failures. A lost GPU device during load usually means not
enough GPU memory, and WebLLM's advice is to retry with a smaller model
([engine.ts][engine]). `navigator.deviceMemory` exists only in Chromium
([MDN BCD][nav]), so it can't be a universal check.

## Recommendation (input for later decision tickets, not a decision)

- **Feasible.** WebLLM fits a desktop/laptop-only "suggest" button. Use
  constrained JSON output and keep thinking mode off.
- **Model shortlist to prototype:**
  - Qwen3-1.7B (~1 GB, broadest language claim among small low-resource
    models).
  - Gemma 3 1B (~0.6 GB, smallest credible option).
  - Qwen3.5-2B (~1.1 GB, newest, widest language claim, but not marked
    low-resource).
  - Pick one by running a small per-language eval on the final language list.
- **Host the weights on Hugging Face (WebLLM's default) for v1**, and
  optionally self-host only the ~6.6 MB `.wasm`. Self-hosting the weights on
  Hobby is possible through a build-time download, but about 100 first-time
  downloads a month would exhaust the transfer allowance. The penalty is a
  30-day pause of the whole account, which is a poor trade for a playground.
- **Make the download explicit.** Show the size, a progress bar, and a "remove
  model" control. Never auto-download. Call `navigator.storage.persist()` so a
  large cache doesn't put the glossaries at risk of eviction.
- **Gate in two layers:** phone detection (product rule), then WebGPU
  capability checks, with a graceful "not available on this device" state.

## Sources

[engine]: https://github.com/mlc-ai/web-llm/blob/main/src/engine.ts
[config]: https://github.com/mlc-ai/web-llm/blob/main/src/config.ts
[cc]: https://github.com/mlc-ai/web-llm/blob/main/src/openai_api_protocols/chat_completion.ts
[support]: https://github.com/mlc-ai/web-llm/blob/main/src/support.ts
[cacheutil]: https://github.com/mlc-ai/web-llm/blob/main/src/cache_util.ts
[src]: https://github.com/mlc-ai/web-llm/tree/main/src
[readme]: https://github.com/mlc-ai/web-llm/blob/main/README.md
[api]: https://github.com/mlc-ai/web-llm/blob/main/docs/user/api_reference.rst
[adv]: https://github.com/mlc-ai/web-llm/blob/main/docs/user/advanced_usage.rst
[cacheex]: https://github.com/mlc-ai/web-llm/blob/main/examples/cache-usage/README.md
[paper]: https://arxiv.org/abs/2412.15803
[qwen3]: https://huggingface.co/Qwen/Qwen3-1.7B
[qwen35]: https://huggingface.co/Qwen/Qwen3.5-2B
[gemma4]: https://huggingface.co/google/gemma-4-E2B-it
[gemma3]: https://arxiv.org/abs/2503.19786
[llama32]: https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/MODEL_CARD.md
[bcd]: https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json
[uad]: https://github.com/mdn/browser-compat-data/blob/main/api/NavigatorUAData.json
[nav]: https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json
[ciu]: https://caniuse.com/webgpu
[quota]: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
[hobby]: https://vercel.com/docs/plans/hobby
[limits]: https://vercel.com/docs/limits
[cdn]: https://vercel.com/docs/caching/cdn-cache
[gitsettings]: https://vercel.com/docs/project-configuration/git-settings
[terms]: https://vercel.com/legal/terms
[ghlarge]: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
[lfs]: https://docs.github.com/en/billing/concepts/product-billing/git-lfs

- WebLLM source and docs, `mlc-ai/web-llm` v0.2.89: [engine.ts][engine],
  [config.ts][config], [chat_completion.ts][cc], [support.ts][support],
  [cache_util.ts][cacheutil], [README][readme], [API reference][api],
  [advanced usage][adv], [cache example][cacheex]
- WebLLM paper: Ruan et al., "WebLLM: A High-Performance In-Browser LLM
  Inference Engine" ([arXiv 2412.15803][paper])
- Model cards: [Qwen3][qwen3], [Qwen3.5][qwen35], [Gemma 4][gemma4],
  [Llama 3.2][llama32], [Gemma 3 technical report][gemma3]
- Model download sizes: Hugging Face API
  `https://huggingface.co/api/models/mlc-ai/<model_id>/tree/main`
- Browser support: [MDN browser-compat-data GPU][bcd],
  [NavigatorUAData][uad], [Navigator][nav], [caniuse WebGPU][ciu],
  [MDN storage quotas][quota]
- Vercel: [Hobby plan][hobby], [Limits][limits], [CDN cache][cdn],
  [Git settings][gitsettings], [Terms][terms]
- GitHub: [large files][ghlarge], [Git LFS billing][lfs]
