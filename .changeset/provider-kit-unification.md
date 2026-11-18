---
"ampersand-bridge-copilot-chat": patch
---

Forward tool-result images and tighten error details

- Vision models now receive images returned by tools (for example screenshots) after every parallel tool call settles; text-only models keep a placeholder.
- HTTP errors show only a bounded, provider-authored message from structured error bodies; raw response bodies are never echoed.
- Inline suggestions also strip code fences that some models wrap around completions.

Shared provider plumbing now comes from the copilot-chat-kit submodule, so fixes land in every Copilot Chat provider extension at once.
