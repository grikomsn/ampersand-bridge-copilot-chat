# Security model

Ampersand Bridge is an independent extension and is not affiliated with,
endorsed by, or supported by ai&. It talks only to the public ai& API endpoints
listed below using your own ai& API key.

ai& API keys are owned by VS Code's native secret provider configuration. The extension keeps provisioned keys only in memory and never copies them into settings, files, extension logs, or this repository.

Entries are identified by the group name you type in **Manage Language Models**; VS Code namespaces each entry's model identifiers per group and never exposes the group name to the provider, so no entry identifiers are tracked by the extension. Catalogs and inference usage scopes include a one-way key fingerprint, and keeping or rotating a key re-scopes the entry automatically.

Credit balances are fetched live per credential and never persisted; only locally tracked inference activity (token and cost totals) survives restarts, scoped per key fingerprint. No entry identity state is persisted by the extension.

Delete or update credentials through **Manage Language Models**. VS Code stores and updates the key, and removing an entry deletes its VS Code-owned credential; this does not revoke the remote API key.

Create dedicated API keys in the Ampersand Bridge dashboard and set per-key rate or spend limits there. Rotate or revoke the key in the dashboard when it is no longer needed.

## Network access

The extension contacts:

- `https://api.aiand.com/v1/models` for hosted model discovery and key validation
- `https://api.aiand.com/v1/chat/completions` for inference and inline suggestions
- `https://api.aiand.com/billing/balance` for the credit balance and daily request allowance
- `https://models.dev/api.json` for best-effort capability metadata only

The live catalog remains authoritative. Prompt and tool content is sent only to the model API for inference. The extension never sends API keys, prompts, or responses to models.dev.

## Inline completions

When `ampersandBridge.inlineSuggestions` is enabled, each suggestion sends a bounded window of the current document (a fixed number of lines before the cursor and a bounded suffix after it) using the most recently provisioned entry's API key to the same `/chat/completions` endpoint. Hidden reasoning deltas are discarded so they can never leak into ghost text. Upstream error bodies are never surfaced or logged because they can echo prompt context. The feature is disabled by default.

## Logging

Debug logs contain model IDs, request state, retries, usage counters, and error summaries. They exclude API keys, authorization headers, prompts, tool arguments, and response text. Streamed API errors are reported without echoing upstream response bodies. Credential references are short one-way hashes used only to isolate in-memory and persisted model catalogs.
