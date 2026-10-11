# Setup

Ampersand Bridge connects GitHub Copilot Chat to the [ai&](https://docs.aiand.com)
hosted model service with your own ai& API key. The extension is independent and
not affiliated with ai& — see [security](./security.md) for the exact network
surface.

## Requirements

- VS Code 1.125 or newer with GitHub Copilot Chat
- An ai& API key (create one in the [ai& console](https://console.aiand.com/settings/api-keys)
  via **Ampersand Bridge: Open API Keys**)

## Connect

1. Install the extension and open the Copilot Chat model picker.
2. Choose **Manage Language Models…**, add an **Ampersand Bridge** provider
   entry, name it (for example `personal` or `work`), and paste your API key.
   VS Code stores the key in its secure secret storage.
3. The entry's models appear as its own group in the model picker; the editor
   namespaces them per entry group so multiple entries never collide.
4. Run **Ampersand Bridge: Manage Connection** to refresh models, test
   inference, inline-suggestion setup, or usage.

The entry name is the entry's identity. Rotating a key in Manage Language
Models re-scopes the entry's credential automatically; removing an entry
deletes its VS Code-owned credential. No entry IDs, alias blocks, or manual
restore steps remain.

## Commands

| Command | Purpose |
|---|---|
| Ampersand Bridge: Manage Connection | Quick pick over models, usage, inline suggestions, and diagnostics |
| Ampersand Bridge: Refresh Models | Re-fetch the hosted model catalog |
| Ampersand Bridge: Show Usage and Credits | Credit balance, daily allowance, and locally tracked tokens |
| Ampersand Bridge: Test Inference | One-shot chat verification |
| Ampersand Bridge: Set Inline Suggestions Model | Pick a vetted ghost-text model (measured latency badges) |
| Ampersand Bridge: Open API Keys | Open the dashboard page to create or rotate keys |
| Ampersand Bridge: Show Diagnostics | VS Code version, endpoint, and registered models |

## Settings

All settings live under `ampersandBridge.*`:

| Setting | Default | Description |
|---|---|---|
| `reasoningEffort` | `high` | Default reasoning effort; per-model picker selections override it and unsupported values are never sent |
| `maxOutputTokens` | `0` | Cap the response reserve (0 reserves up to 32,768 tokens) |
| `requestTimeoutSeconds` | `600` | Total request timeout |
| `streamIdleTimeoutSeconds` | `120` | Abort when no streamed data arrives |
| `catalogCacheMinutes` | `5` | How long a discovery snapshot is reused |
| `showUsageStatusBar` | `true` | Credit-balance status bar item |
| `debugLogging` | `false` | Model IDs, retries, and usage metadata in the output channel (never prompts or keys) |
| `inlineSuggestions` | `false` | Opt in to ghost-text inline completions |
| `inlineSuggestionsModel` | `deepseek-ai/deepseek-v4-flash` | Model id for inline completions |
| `inlineSuggestionsChatInput` | `false` | Also complete inside the Copilot Chat prompt box |
| `inlineSuggestionsDebounceMs` | `300` | Typing debounce (50–2000) |
| `inlineSuggestionsTimeoutMs` | `3000` | Per-suggestion timeout (500–15000) |
| `inlineSuggestionsMaxTokens` | `128` | Max completion tokens (16–1024) |
| `inlineSuggestionsPrefixLines` | `10` | Document lines sent before the cursor |
| `inlineSuggestionsSuffixChars` | `300` | Characters sent after the cursor |

## Inline suggestions

Inline completions are emulated fill-in-the-middle over the same chat
endpoint: the prompt is bracketed with `<|fim_prefix|>` / `<|fim_suffix|>` /
`<|fim_middle|>` tokens, temperature is pinned to 0, and the reasoning effort
is pinned to `none` when the model accepts it (else its lightest listed
effort). Hidden reasoning is discarded, upstream error bodies are never shown,
and superseded requests are aborted upstream. See
[models](./models.md) for measured latency badges in the picker.

## Troubleshooting

- **No models listed**: the key was refused (HTTP 401/403). Update the entry's
  key in Manage Language Models; the picker recovers after the cache window or
  on the next successful discovery.
- **Stale model selections after key rotation**: reselect the model after
  updating the key; the new credential scope is provisioned on the next pick.
- **Reasoning effort errors upstream**: a model only accepts its own effort
  list; reset the picker selection to the model's default.
- **Usage shows an error**: the balance endpoint is fetched live per request of
  the command; run **Show Usage and Credits** to retry.
