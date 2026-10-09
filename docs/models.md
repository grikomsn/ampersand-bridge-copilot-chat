# Models

Model discovery is live-first against the ai& service: `GET /v1/models` is
authoritative for every native provider entry, filtered to chat-capable hosted
models, and cached per credential for `ampersandBridge.catalogCacheMinutes`
(default 5). Successful snapshots persist to workspace storage so the picker
survives unavailable refreshes. A key the service refuses (HTTP 401/403) lists
no models at all, because every request would fail.

When discovery is unavailable, the picker falls back to the bundled catalog
below. Contexts, output ceilings, image input, and reasoning efforts come from
the hosted catalog snapshot; live values always win over bundled rows, and
models.dev metadata fills gaps for unknown models without ever widening an
authoritative live effort list.

Snapshot checked against the hosted catalog on 2026-10-09.

| Model | ID | Context | Max output | Image input | Reasoning efforts (default) |
|---|---|---|---|---|---|
| GPT OSS 120B | `openai/gpt-oss-120b` | 131K | 32K | — | low / medium / high (medium) |
| DeepSeek V4.1 Flash | `deepseek-ai/deepseek-v4.1-flash` | 1M | 384K | ✓ | none / high / max (high) |
| DeepSeek V4 Flash | `deepseek-ai/deepseek-v4-flash` | 1M | 384K | — | none / high / max (high) |
| DeepSeek V4 Pro | `deepseek-ai/deepseek-v4-pro` | 1M | 384K | — | none / high / max (high) |
| Kimi K3 | `moonshotai/kimi-k3` | 1M | 131K | ✓ | low / high / max (max) |
| Kimi K2.7 Code | `moonshotai/kimi-k2.7-code` | 262K | 262K | ✓ | high (high) |
| GLM 5.3 Flash | `zai-org/glm-5.3-flash` | ~1M (1,048,550) | 131K | ✓ | low / high / max (max) |
| GLM 5.3 | `zai-org/glm-5.3` | 1M | 131K | — | low / high / max (max) |
| GLM 5.2 | `zai-org/glm-5.2` | 1M | 131K | — | none / high / max (max) |
| Gemma 4 31B IT | `google/gemma-4-31b-it` | 262K | 32K | ✓ | none / high (none) |
| Qwen 3.8 27B | `qwen/qwen3.8-27b` | 262K | 32K | ✓ | none / low / medium / xhigh (xhigh) |
| Qwen 3.6 27B | `qwen/qwen3.6-27b` | 262K | 65K | ✓ | none / high (high) |
| Motif 3 | `motif-technologies/motif-3` | 262K | 262K | — | none / high (high) |

## Reasoning efforts

Each model exposes its own effort list from the hosted catalog, and the model
picker shows a **Reasoning Effort** selection restricted to that list. The
workspace default (`ampersandBridge.reasoningEffort`) is used when the model
accepts it; otherwise the model's own default applies. Sending an unsupported
effort fails upstream with an HTTP 400, so unsupported values are never sent.
Kimi K2.7 Code only accepts `high`, which is why inline suggestions recommend
other models.

## Context window tiers

Models above 64K input tokens also offer a **Context Window** picker
(Auto / 64K / 128K / 200K / Maximum). A tier trims the oldest conversation
turns at user-turn boundaries — tool call/result pairs are never split — and
Auto keeps the model's full advertised window.

## Pricing

Bundled USD-per-1M-token estimates (input / cache read / output) power the
picker's price labels; live catalog pricing wins when present:

| Model | Input | Cache read | Output |
|---|---|---|---|
| `openai/gpt-oss-120b` | $0.15 | $0.08 | $0.60 |
| `deepseek-ai/deepseek-v4.1-flash` | $0.30 | $0.02 | $0.60 |
| `deepseek-ai/deepseek-v4-flash` | $0.15 | $0.08 | $0.25 |
| `deepseek-ai/deepseek-v4-pro` | $1.00 | $0.25 | $2.50 |
| `moonshotai/kimi-k3` | $3.00 | $0.50 | $12.50 |
| `moonshotai/kimi-k2.7-code` | $0.75 | $0.20 | $3.50 |
| `zai-org/glm-5.3-flash` | $0.15 | $0.03 | $0.50 |
| `zai-org/glm-5.3` | $1.00 | $0.30 | $4.00 |
| `zai-org/glm-5.2` | $1.00 | $0.30 | $4.00 |
| `google/gemma-4-31b-it` | $0.20 | $0.05 | $0.50 |
| `qwen/qwen3.8-27b` | $0.40 | $0.20 | $3.00 |
| `qwen/qwen3.6-27b` | $0.32 | $0.20 | $3.20 |
| `motif-technologies/motif-3` | $0.50 | $0.20 | $2.00 |

The resync automation (`scripts/refresh-models.mjs`, weekly workflow when
configured) reports drift against the live catalog and models.dev and opens a
pull request when bundled rows need updating.
