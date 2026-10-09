# Ampersand Bridge for GitHub Copilot Chat

<p align="center">
  <img src="assets/cover.jpg" alt="Ampersand Bridge cover" width="640" />
</p>

<h1 align="center">Ampersand Bridge for GitHub Copilot Chat</h1>

<p align="center">
  <a href="https://github.com/grikomsn/ampersand-bridge-copilot-chat/releases"><img src="https://img.shields.io/github/v/release/grikomsn/ampersand-bridge-copilot-chat?filter=!v0.0.0" alt="Release" /></a>
  <a href="https://github.com/grikomsn/ampersand-bridge-copilot-chat/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/grikomsn/ampersand-bridge-copilot-chat/ci.yml?branch=main" alt="CI" /></a>
  <a href="https://github.com/grikomsn/ampersand-bridge-copilot-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/grikomsn/ampersand-bridge-copilot-chat" alt="License" /></a>
</p>

Use hosted Ampersand Bridge models in GitHub Copilot Chat with your own API
key — streaming answers, reasoning visibility, tool calls, image input, credit
balance tracking, and opt-in ghost-text inline suggestions, all through native
VS Code provider entries.

## Highlights

- **Bring your own key** — add one or more provider entries in Manage Language
  Models; VS Code stores each key securely and every entry is isolated by a
  stable `entryId`.
- **Live model catalog** — discovery follows the hosted catalog with
  per-credential snapshots, models.dev enrichment, and per-model
  reasoning-effort lists.
- **Full chat surface** — streamed text, thinking segments, tool calls, image
  input when a model advertises it, context-window tiers, and credit-balance
  usage in the status bar.
- **Inline suggestions** — opt-in fill-in-the-middle ghost text with measured
  latency badges and reasoning suppressed.

## Quick start

1. Install the extension.
2. Run **Ampersand Bridge: Open API Keys** to create a key in the dashboard.
3. In the Copilot Chat model picker, choose **Manage Language Models…**, add an
   Ampersand Bridge entry with a unique `entryId`, and paste the key.
4. Pick a model and chat. Use **Ampersand Bridge: Manage Connection** for
   entries, usage, and inline suggestions.

See [docs/setup.md](docs/setup.md) for the full guide, [docs/models.md](docs/models.md)
for the bundled catalog and pricing, and [docs/security.md](docs/security.md) for the
security model.

## Related projects

Other Copilot Chat providers from the same family: `grok-copilot-chat`,
`inception-copilot-chat`, `ollama-cloud-copilot-chat`,
`opencode-copilot-chat`, `orvix-copilot-chat`, `poolside-copilot-chat`,
`openai-oauth-copilot-chat`.

## License

[MIT](LICENSE)
