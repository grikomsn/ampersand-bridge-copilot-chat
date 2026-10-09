# Changelog

## 1.0.0

### Major Changes

- 6865e1b: First stable release. Mark the provider as production-ready: native entries with
  stable `entryId`s and VS Code-owned keys, the live ai& catalog with per-credential
  snapshots, per-model reasoning efforts, credit-balance usage tracking, and opt-in
  fill-in-the-middle inline suggestions have all settled across the 0.x bootstrap
  releases with no further breaking changes planned.

## 0.2.0

### Minor Changes

- 9667969: Initial bootstrap of Ampersand Bridge for GitHub Copilot Chat: native VS Code
  provider entries with a required stable `entryId` and VS Code-owned API keys,
  hosted model discovery with per-credential persisted catalogs and models.dev
  enrichment, streamed reasoning and tool calls with fragment/CRLF-safe parsing,
  per-model reasoning-effort lists, credit-balance usage with locally tracked
  tokens, and opt-in fill-in-the-middle inline suggestions with measured model
  candidates.

### Patch Changes

- 55b7b4d: Align the extension icon and README cover with the sibling providers' black
  background, white provider mark, and blue-purple Copilot motif using an
  independent angular ampersand identity.

All notable changes to this project will be documented in this file.

Versioning follows semver. Releases are managed with Changesets and published to
the Visual Studio Marketplace as `grikomsn.ampersand-bridge-copilot-chat`.

## [Unreleased]

### Added

- Initial bootstrap: native VS Code provider entries with a required stable
  `entryId` and VS Code-owned API keys, hosted model discovery with per-credential
  persisted catalogs, models.dev metadata enrichment, streamed reasoning and tool
  calls, per-model reasoning-effort lists, credit-balance usage, and opt-in
  fill-in-the-middle inline suggestions with measured model candidates.
