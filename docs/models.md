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

Snapshot checked against the hosted catalog on 2026-10-30.

| Model | ID | Context | Max output | Image input | Reasoning efforts (default) |
|---|---|---|---|---|---|
| GPT OSS 120B | `openai/gpt-oss-120b` | 131K | 32K | — | low / medium / high (medium) |
| DeepSeek V4.1 Flash | `deepseek-ai/deepseek-v4.1-flash` | 1M | 384K | ✓ | none / high / max (high) |
| DeepSeek V4.1 Flash 1017 | `deepseek-ai/deepseek-v4.1-flash-1017` | 1M | 384K | ✓ | none / high / max (high) |
| DeepSeek V4 Pro | `deepseek-ai/deepseek-v4-pro` | 1M | 384K | — | none / high / max (high) |
| Kimi K3 | `moonshotai/kimi-k3` | 1M | 131K | ✓ | low / high / max (max) |
| GLM 5.3 Flash | `zai-org/glm-5.3-flash` | ~1M (1,048,550) | 131K | ✓ | low / high / max (max) |
| GLM 5.3 | `zai-org/glm-5.3` | 1M | 131K | — | low / high / max (max) |
| Gemma 4 31B IT | `google/gemma-4-31b-it` | 262K | 32K | ✓ | none / high (none) |
| Qwen 3.8 27B | `qwen/qwen3.8-27b` | 262K | 32K | ✓ | none / low / medium / xhigh (xhigh) |
| Qwen 3.6 27B | `qwen/qwen3.6-27b` | 262K | 65K | ✓ | none / high (high) |
| Motif 3 | `motif-technologies/motif-3` | 262K | 262K | — | none / high (high) |
| Muse Spark Open | `meta/muse-spark-open` | 1M | 922K | ✓ | low / medium / high / xhigh (low) |

DeepSeek V4 Flash, Kimi K2.7 Code, and GLM 5.2 were removed ahead of their 2026-10-27 end of support. The recommended replacements are DeepSeek V4.1 Flash for DeepSeek, Kimi K3 for Kimi, and GLM 5.3 Flash for GLM. The ai& service still serves the retiring ids until that date, so the extension filters them out of the picker, the inline-suggestion candidate list, and persisted per-credential snapshots rather than offering a model that will stop working.

## Reasoning efforts

Each model exposes its own effort list from the hosted catalog, and the model
picker shows a **Reasoning Effort** selection restricted to that list. The
workspace default (`ampersandBridge.reasoningEffort`) is used when the model
accepts it; otherwise the model's own default applies. Sending an unsupported
effort fails upstream with an HTTP 400, so unsupported values are never sent.
Kimi K3 accepts `low`, `high`, and `max` but not `none`, so inline suggestions
recommend other models.

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
| `deepseek-ai/deepseek-v4.1-flash-1017` | $0.30 | $0.02 | $0.60 |
| `deepseek-ai/deepseek-v4-pro` | $1.00 | $0.25 | $2.50 |
| `moonshotai/kimi-k3` | $3.00 | $0.50 | $12.50 |
| `zai-org/glm-5.3-flash` | $0.15 | $0.03 | $0.50 |
| `zai-org/glm-5.3` | $1.00 | $0.30 | $4.00 |
| `google/gemma-4-31b-it` | $0.20 | $0.05 | $0.50 |
| `qwen/qwen3.8-27b` | $0.40 | $0.20 | $3.00 |
| `qwen/qwen3.6-27b` | $0.32 | $0.20 | $3.20 |
| `motif-technologies/motif-3` | $0.50 | $0.20 | $2.00 |
| `meta/muse-spark-open` | $1.25 | $0.15 | $4.25 |

The resync automation (`scripts/refresh-models.mjs`, weekly workflow when
configured) reports drift against the live catalog and models.dev and opens a
pull request when bundled rows need updating.

## Copilot SDK sessions

The **Copilot** session runtime uses a separate model-discovery path from
ordinary **Local** chat. Its BYOK bridge discovers effort options specifically
from `configurationSchema.properties.reasoningEffort`. Keep that property
separate from Context Window and other controls, with the model's supported
values and a default from that list.

In VS Code 1.141, the SDK picker further restricts efforts to `none`, `minimal`,
`low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. Each model exposes only the
intersection with its own supported list. The extension continues translating
selected efforts to the provider's native request fields.

The ai& model's live effort list remains authoritative in both runtimes;
SDK discovery never adds levels outside that list. Models without reasoning
controls retain no effort picker or request parameter. Use Local chat for the
extension's Context Window control; the SDK picker does not expose it.

After installing an extension update, restart VS Code or reload every open
window so the shared BYOK bridge receives fresh model metadata.

References: [VS Code BYOK discovery](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostByokLmHandler.ts),
[SDK Thinking Level filtering](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L2757),
and [accepted agent-host effort tiers](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/platform/agentHost/common/reasoningEffort.ts).
