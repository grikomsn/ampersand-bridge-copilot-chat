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
   entry, give it a unique `entryId` (for example `personal` or `work`), and
   paste your API key. VS Code stores the key in its secure secret storage.
3. The entry's models appear as a group in the model picker, qualified as
   `<entryId>::<modelId>` so multiple entries never collide.
4. Run **Ampersand Bridge: Manage Connection** to select the management entry
   (used for usage, refresh, and connection tests), the inline-suggestions
   entry, or to forget/restore entries.

Keep the `entryId` when you rotate the key: the rotation retires stale model
handles automatically. Removing an entry from Manage Language Models should be
preceded by **Ampersand Bridge: Forget Native Entry** so cached state is
retired before the removal.

## Commands

| Command | Purpose |
|---|---|
| Ampersand Bridge: Manage Connection | Quick pick over entries, models, usage, inline suggestions, and diagnostics |
| Ampersand Bridge: Select Management Entry | Choose the entry powering usage, refresh, and tests |
| Ampersand Bridge: Select Inline Suggestions Entry | Choose the entry powering inline completions |
| Ampersand Bridge: Refresh Models | Re-fetch the hosted model catalog |
| Ampersand Bridge: Show Usage and Credits | Credit balance, daily allowance, and locally tracked tokens |
| Ampersand Bridge: Test Inference | One-shot chat verification with the selected entry |
| Ampersand Bridge: Set Inline Suggestions Model | Pick a vetted ghost-text model (measured latency badges) |
| Ampersand Bridge: Open API Keys | Open the dashboard page to create or rotate keys |
| Ampersand Bridge: Show Diagnostics | VS Code version, endpoint, entries, and registered models |
| Ampersand Bridge: Forget Native Entry | Retire cached state before removing an entry |
| Ampersand Bridge: Restore Native Entry | Allow a forgotten entry ID to be provisioned again |

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
| `managementEntry` / `inlineSuggestionsEntry` | `""` | Explicit `entryId` selections (no automatic fallback) |

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
  key in Manage Language Models; the picker recovers on the next successful
  discovery.
- **Stale model handles after rotation**: keep the same `entryId` and reselect
  the model; generation checks reject retired handles until VS Code
  re-provisions the entry.
- **Reasoning effort errors upstream**: a model only accepts its own effort
  list; reset the picker selection to the model's default.
- **Usage shows an error**: the balance endpoint is fetched live per request of
  the command; run **Show Usage and Credits** to retry.
