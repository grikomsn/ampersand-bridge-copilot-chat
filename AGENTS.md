# Repository guidance

## Scope and setup

- These instructions apply to the entire repository.
- This is a strict-TypeScript VS Code `LanguageModelChatProvider`. Use Node.js 22+ and npm; `package-lock.json` is authoritative.
- Install from a clean checkout with `npm ci`.
- The extension is **Ampersand Bridge** (independent, not affiliated with ai&) and bridges VS Code to the public **ai&** service at `api.aiand.com`. Docs must keep that split: extension = Ampersand Bridge, service = ai&.

## Code map

- `src/extension.ts`: activation and dependency wiring.
- `src/commands/commands.ts`: commands, diagnostics, and connection workflows.
- `src/auth/auth.ts`: credential fingerprint helper (VS Code owns the API keys).
- `src/provider.ts`: VS Code provider integration, native-entry registration, model discovery, and request lifecycle.
- `src/provider-profile.ts`: entry ID validation, native-entry generations, and qualified model IDs.
- `src/provider/`: message conversion, request construction, response reporting, and retry policy.
- `src/models/`: catalog, persisted per-credential snapshots, models.dev enrichment, reasoning-effort options, and pricing.
- `src/transport/`: fixed endpoints, request identity, errors, and incremental SSE parsing.
- `src/usage/`: balance normalization, local usage tracking, and status-bar rendering.
- `src/autocomplete/`: opt-in fill-in-the-middle inline suggestions.
- `src/vscode/`: proposed VS Code API type augmentations.
- `scripts/refresh-models.mjs`: model-metadata resync automation (report/apply/pr/ci modes).
- Tests are colocated as `src/**/*.test.ts` using `node:test`; `test/native/index.js` drives an end-to-end provider harness with injected VS Code fakes. `out/` and `*.vsix` are generated artifacts.

## Commands

- `npm run compile` — clean and type-check into `out/`.
- `npm test` or `npm run check` — compile and run all Node test files.
- `npm run package` — validate and build the installable VSIX.
- `npm run watch` — compile continuously; press F5 with the launch configuration for an Extension Development Host.
- `npm run refresh-models` — report hosted-model drift; `--apply` edits bundled metadata, `--pr` opens a resync pull request.

## Working agreements

- Keep changes focused and follow the existing strict TypeScript style: explicit public types, small helpers, double quotes, and two-space indentation.
- Add or update colocated `node:test` coverage for behavior changes. Network paths must use injected fakes rather than live services.
- API keys live only in VS Code-managed provider-entry configuration. Never log or commit keys, prompts, tool arguments, responses, or account data.
- Native entries require a unique stable `entryId`; rotating a key retires issued model handles, and forgotten entry IDs stay blocked until explicitly restored.
- Treat the live `/v1/models` response as authoritative. Persist per-credential snapshots for unavailable refreshes, list nothing when the service refuses a key, and never merge stale entries into a successful response.
- Requests must use the fixed endpoints from `src/transport/protocol.ts`; never redirect credentials through a workspace-configurable endpoint.
- Per-model reasoning-effort lists are authoritative: never widen a live list with metadata, and never send an effort the model does not accept.
- Retry only pre-stream transient failures and keep protocol-specific behavior covered by tests.
- When commands, settings, models, security behavior, or workflows change, keep `package.json`, tests, documentation, and Changesets synchronized.
- Do not commit generated `out/`, source maps, VSIX files, logs, or unrelated dependency churn.

## Before handing off

- Run the narrowest relevant test while iterating, then `npm run check`.
- Also run `npm run package` for manifest, packaging, or release-facing changes.
- Add a Changeset with `npm run changeset` for user-visible published-extension changes. Documentation, tests, and repository-maintenance-only changes do not require one.
