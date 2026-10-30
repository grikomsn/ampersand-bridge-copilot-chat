# Changelog

## 2.0.5

### Patch Changes

- 6c0a64b: Add DeepSeek V4.1 Flash 1017 and Muse Spark Open to the bundled fallback catalog.

## 2.0.4

### Patch Changes

- 80a2db3: Remove DeepSeek V4 Flash, Kimi K2.7 Code, and GLM 5.2 ahead of their October 27, 2026 end of support, and point inline-completion guidance to DeepSeek V4.1 Flash.

## 2.0.3

### Patch Changes

- 3287303: Count tool results, tool arguments, thinking, and image inputs when budgeting Copilot Chat context, and explain how to recover from context-window errors.

## 2.0.2

### Patch Changes

- 039505e: Map aborted requests to a friendly "Request cancelled or timed out" message in
  shared error formatting instead of surfacing the raw AbortError text.

## 2.0.1

### Patch Changes

- 7edc9ed: Document Copilot SDK reasoning controls and their supported effort tiers, and add regression coverage for discovery and native request translation. Existing provider request behavior is preserved.

## 2.0.0

### Major Changes

- 267f4e2: Native entries no longer require an `entryId`: the group name you type in Manage Language Models is the entry's identity, and only the API key is prompted. Model IDs are raw hosted ids (the editor namespaces them per entry group), so saved model selections must be rechosen once after upgrading. Forget/restore and entry-selection commands and settings, and the observation journal, were removed; management commands and inline suggestions use the most recently provisioned entry key.

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
