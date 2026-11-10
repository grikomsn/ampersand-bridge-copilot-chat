---
"ampersand-bridge-copilot-chat": minor
---

Retire DeepSeek V4.1 Flash. The hosted catalog removed `deepseek-ai/deepseek-v4.1-flash` after its 2026-11-06 end of support, so it now leaves the model picker, the fallback catalog, the inline-suggestion candidate list, and persisted per-credential snapshots. Its replacement, `deepseek-ai/deepseek-v4.1-flash-1017`, becomes the default inline-suggestions model, and a stored `ampersandBridge.inlineSuggestionsModel` naming any retired id now falls back to that default instead of failing silently.
