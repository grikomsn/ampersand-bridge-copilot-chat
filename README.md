<p align="center">
  <img src="https://raw.githubusercontent.com/grikomsn/ampersand-bridge-copilot-chat/main/assets/cover.jpg" alt="Ampersand Bridge and GitHub Copilot" width="960">
</p>

<h1 align="center">Ampersand Bridge for GitHub Copilot Chat</h1>

<p align="center">Use ai& models directly from the GitHub Copilot Chat model picker in Visual Studio Code.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=grikomsn.ampersand-bridge-copilot-chat"><img src="https://img.shields.io/visual-studio-marketplace/v/grikomsn.ampersand-bridge-copilot-chat?style=flat-square&logo=visualstudiocode&label=Marketplace" alt="Visual Studio Marketplace version"></a>
  <a href="https://github.com/grikomsn/ampersand-bridge-copilot-chat/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/grikomsn/ampersand-bridge-copilot-chat/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a>
  <a href="https://github.com/grikomsn/ampersand-bridge-copilot-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/grikomsn/ampersand-bridge-copilot-chat?style=flat-square" alt="MIT license"></a>
</p>

This extension is a native VS Code `LanguageModelChatProvider`. It validates your ai& API key, discovers the hosted models available to it, and streams OpenAI-compatible chat completions directly from `https://api.aiand.com/v1` into Copilot Chat.

Ampersand Bridge is community-maintained and independent: it is not affiliated with, endorsed by, or supported by ai&. For the officially maintained experience, consider [ai& for GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=aiand.aiand-copilot) (`aiand.aiand-copilot`). See the [security model](docs/security.md) for the exact network surface.

## Highlights

- Direct ai& integration without a local proxy
- API keys owned by VS Code native provider configuration
- Multiple isolated entries with stable explicit IDs in Manage Language Models
- Live `/v1/models` discovery with durable per-credential catalog snapshots
- Streaming text, reasoning output, token usage, and function-tool calls
- Per-model reasoning-effort lists that never send an unsupported effort
- Bounded retries for pre-stream transient failures only
- ai& credit balance and usage tracking with a status-bar item and quick-pick details
- Best-effort per-token pricing in the model picker, sourced from live API data or bundled estimates
- Opt-in fill-in-the-middle inline suggestions with measured model badges and reasoning suppressed

## Quick start

1. Install the extension. You need VS Code 1.125 or newer and GitHub Copilot Chat.
2. Create an API key in the [ai& console](https://console.aiand.com/settings/api-keys), or run **Ampersand Bridge: Open API Keys**.
3. Open Copilot Chat, select **Manage Models**, add an **Ampersand Bridge** provider entry, and enter a unique lowercase **Entry ID** plus the key.
4. Choose any model returned for that key.

To use more than one key, add another **Ampersand Bridge** entry with a different Entry ID. Keep that ID when rotating the key; saved model selections stay stable and old request handles are retired. Use **Ampersand Bridge: Manage Connection** to select entries independently for management and inline suggestions, and to refresh models, test inference, or show usage. Before deleting an entry, run **Ampersand Bridge: Forget Native Entry** and remove it in Manage Language Models.

## Documentation

- [Setup, settings, and troubleshooting](docs/setup.md)
- [Models and pricing](docs/models.md)
- [API key and security model](docs/security.md)
- [Development and releases](docs/development.md)

## Related projects

- [Codex Bridge for Copilot Chat](https://github.com/grikomsn/openai-oauth-copilot-chat) — Use OpenAI Codex models in Copilot Chat with a ChatGPT Plus or Pro subscription.
- [Grok for GitHub Copilot Chat](https://github.com/grikomsn/grok-copilot-chat) — Use xAI Grok models directly from the GitHub Copilot Chat model picker.
- [Inception for GitHub Copilot Chat](https://github.com/grikomsn/inception-copilot-chat) — Use Inception Mercury models directly from the GitHub Copilot Chat model picker.
- [Ollama Cloud for GitHub Copilot Chat](https://github.com/grikomsn/ollama-cloud-copilot-chat) — Use Ollama Cloud models with native thinking and tool support.
- [OpenCode for GitHub Copilot Chat](https://github.com/grikomsn/opencode-copilot-chat) — Use OpenCode Zen, Go, and Console models from the model picker.
- [Orvix for GitHub Copilot Chat](https://github.com/grikomsn/orvix-copilot-chat) — Use Orvix managed and BYOK models directly from the GitHub Copilot Chat model picker.
- [Poolside for GitHub Copilot Chat](https://github.com/grikomsn/poolside-copilot-chat) — Use hosted Poolside coding models directly from the GitHub Copilot Chat model picker.

Unofficial project; not affiliated with ai&, GitHub, or Microsoft. ai& usage limits and charges still apply. Licensed under [MIT](LICENSE).
