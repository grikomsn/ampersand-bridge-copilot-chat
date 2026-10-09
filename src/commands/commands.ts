/** User-facing Ampersand Bridge commands and connection workflows. */

import * as vscode from "vscode";
import { CONFIG_SECTION, DEFAULT_INLINE_MODEL, INLINE_SUGGESTIONS_MODEL_SETTING } from "../autocomplete/config";
import { inlineModelChoices } from "../autocomplete/models";
import { messageOf } from "../errors";
import { API_BASE, AmpersandProvider } from "../provider";
import { formatUsageRows } from "../usage/domain";
import { toUsageQuickPickItem, type UsageQuickPickItem } from "../usage/presentation";

const API_KEYS_URL = "https://console.aiand.com/settings/api-keys";

export function registerCommands(
  provider: AmpersandProvider,
  output: vscode.OutputChannel,
  usageStatus?: vscode.StatusBarItem,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("ampersandBridge.manage", () => manage(provider, output, usageStatus)),
    vscode.commands.registerCommand("ampersandBridge.selectEntry", () => selectEntry(provider, "managementEntry")),
    vscode.commands.registerCommand("ampersandBridge.selectInlineEntry", () => selectEntry(provider, "inlineSuggestionsEntry")),
    vscode.commands.registerCommand("ampersandBridge.forgetEntry", () => forgetEntry(provider)),
    vscode.commands.registerCommand("ampersandBridge.restoreEntry", () => restoreEntry(provider)),
    vscode.commands.registerCommand("ampersandBridge.refreshModels", () => refreshModels(provider)),
    vscode.commands.registerCommand("ampersandBridge.setInlineSuggestionsModel", () => setInlineSuggestionsModel()),
    vscode.commands.registerCommand("ampersandBridge.showUsage", () => showUsage(provider, output)),
    vscode.commands.registerCommand("ampersandBridge.testConnection", () => testConnection(provider, output)),
    vscode.commands.registerCommand("ampersandBridge.openApiKeys", () => openApiKeys()),
    vscode.commands.registerCommand("ampersandBridge.diagnostics", () => diagnostics(provider, output)),
  ];
}

async function manage(
  provider: AmpersandProvider,
  output: vscode.OutputChannel,
  usageStatus?: vscode.StatusBarItem,
): Promise<void> {
  const choices = [
    { label: "$(settings-gear) Manage Language Models", action: "models" },
    { label: "$(account) Select management entry", action: "entry" },
    { label: "$(zap) Select inline suggestions entry", action: "inlineEntry" },
    { label: "$(check) Test selected entry inference", action: "test" },
    { label: "$(refresh) Refresh selected entry models", action: "refresh" },
    { label: "$(zap) Set inline suggestions model", action: "inlineModel" },
    { label: "$(credit-card) Show selected entry usage and credits", action: "usage" },
    { label: "$(trash) Forget entry before removing it", action: "forget" },
    { label: "$(history) Restore forgotten native entry", action: "restore" },
    { label: "$(link-external) Open Ampersand Bridge API keys", action: "open" },
    { label: "$(output) Show Ampersand Bridge logs", action: "logs" },
    { label: "$(info) Show diagnostics", action: "diagnostics" },
  ];
  const picked = await vscode.window.showQuickPick(choices, { title: "Ampersand Bridge — Manage native entries" });
  if (!picked) return;
  if (picked.action === "models") await vscode.commands.executeCommand("workbench.action.chat.manageLanguageModels");
  else if (picked.action === "entry") await selectEntry(provider, "managementEntry");
  else if (picked.action === "inlineEntry") await selectEntry(provider, "inlineSuggestionsEntry");
  else if (picked.action === "forget") await forgetEntry(provider);
  else if (picked.action === "restore") await restoreEntry(provider);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "inlineModel") await setInlineSuggestionsModel();
  else if (picked.action === "test") await testConnection(provider, output);
  else if (picked.action === "usage") await showUsage(provider, output);
  else if (picked.action === "open") await openApiKeys();
  else if (picked.action === "logs") output.show(true);
  else if (picked.action === "diagnostics") await diagnostics(provider, output);
  void usageStatus;
}

async function selectEntry(provider: AmpersandProvider, setting: string): Promise<void> {
  const picked = await vscode.window.showQuickPick(provider.getEntries().map(({ entryId }) => ({ label: entryId })), {
    title: "Ampersand Bridge — Select native entry", placeHolder: "Add entries with unique entryId values in Manage Language Models",
  });
  if (!picked) return;
  await vscode.workspace.getConfiguration(CONFIG_SECTION).update(setting, picked.label, vscode.ConfigurationTarget.Global);
  provider.fireDidChange();
}

async function forgetEntry(provider: AmpersandProvider): Promise<void> {
  const ids = new Set([...provider.getEntries().map(({ entryId }) => entryId), ...Object.keys(provider.getObservedEntries())]);
  const picked = await vscode.window.showQuickPick([...ids].map((label) => ({ label })), {
    title: "Ampersand Bridge — Forget entry", placeHolder: "Retire cached catalogs and usage before removing the native entry",
  });
  if (!picked) return;
  await provider.forgetEntry(picked.label);
  await vscode.commands.executeCommand("workbench.action.chat.manageLanguageModels");
}

async function restoreEntry(provider: AmpersandProvider): Promise<void> {
  const picked = await vscode.window.showQuickPick(provider.getForgottenEntries().map((label) => ({ label })), {
    title: "Ampersand Bridge — Restore native entry", placeHolder: "Allow VS Code to provision this ID again",
  });
  if (!picked) return;
  await provider.restoreEntry(picked.label);
  await vscode.commands.executeCommand("workbench.action.chat.manageLanguageModels");
}

async function refreshModels(provider: AmpersandProvider): Promise<void> {
  try {
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Refreshed ${models.length} Ampersand Bridge hosted models.`);
  } catch (error) {
    vscode.window.showErrorMessage(messageOf(error));
  }
}

interface InlineModelPickItem extends vscode.QuickPickItem {
  readonly action?: string | "custom";
}

async function setInlineSuggestionsModel(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = configuration.get<string>(INLINE_SUGGESTIONS_MODEL_SETTING, DEFAULT_INLINE_MODEL) ?? DEFAULT_INLINE_MODEL;
  const picked = await vscode.window.showQuickPick<InlineModelPickItem>([
    ...inlineModelChoices(current).map((choice) => ({
      label: choice.label,
      description: choice.description,
      detail: choice.detail,
      action: choice.id,
    })),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(pencil) Use a custom model id…", detail: "Enter any Ampersand Bridge model id that completes cleanly at its lightest reasoning effort.", action: "custom" as const },
  ], {
    title: "Ampersand Bridge — Set Inline Suggestions Model",
    placeHolder: `Current: ${current}`,
  });
  if (!picked?.action) return;
  if (picked.action === "custom") {
    const value = await vscode.window.showInputBox({
      title: "Custom inline suggestions model id",
      value: current,
      prompt: "Any Ampersand Bridge model id; the vetted list is a starting point, not a restriction.",
    });
    if (value === undefined || !value.trim()) return;
    await configuration.update(INLINE_SUGGESTIONS_MODEL_SETTING, value.trim(), vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`Ampersand Bridge inline suggestions model set to ${value.trim()}.`);
    return;
  }
  await configuration.update(INLINE_SUGGESTIONS_MODEL_SETTING, picked.action, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`Ampersand Bridge inline suggestions model set to ${picked.action}. Applies on the next keystroke.`);
}

async function testConnection(provider: AmpersandProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Testing Ampersand Bridge inference…",
      },
      () => provider.testConnection(),
    );
    output.appendLine(
      `[test] model=${result.model} effort=${result.reasoningEffort ?? "model-default"} response=${result.text}`,
    );
    vscode.window.showInformationMessage(
      `Ampersand Bridge verified with ${result.model}${result.reasoningEffort ? ` (${result.reasoningEffort} effort)` : ""}: ${result.text}`,
    );
  } catch (error) {
    const message = messageOf(error);
    output.appendLine(`[test] ${message}`);
    vscode.window.showErrorMessage(`Ampersand Bridge connection test failed: ${message}`);
  }
}

async function openApiKeys(): Promise<void> {
  const opened = await vscode.env.openExternal(vscode.Uri.parse(API_KEYS_URL));
  if (!opened) vscode.window.showWarningMessage("VS Code could not open the Ampersand Bridge API-keys page.");
}

interface UsageActionPickItem extends vscode.QuickPickItem {
  action?: "refresh" | "openApiKeys";
}

async function showUsage(provider: AmpersandProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Refreshing Ampersand Bridge credit balance and usage…",
      },
      () => provider.refreshUsage(),
    );
  } catch (error) {
    output.appendLine(`[usage] manual refresh failed: ${messageOf(error)}`);
  }
  const rows = formatUsageRows(provider.getSelectedUsageSnapshot()).map(toUsageQuickPickItem);
  const picked = await vscode.window.showQuickPick<UsageActionPickItem>(
    [
      ...rows,
      { label: "Actions", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(refresh) Refresh balance and usage", action: "refresh" },
      { label: "$(link-external) Open Ampersand Bridge API keys", action: "openApiKeys" },
    ],
    {
      title: "Ampersand Bridge usage",
      placeHolder: "Live credit balance plus locally tracked inference tokens",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (picked?.action === "refresh") await showUsage(provider, output);
  else if (picked?.action === "openApiKeys") await openApiKeys();
}

async function diagnostics(provider: AmpersandProvider, output: vscode.OutputChannel): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: "ampersand-bridge" });
  const entries = provider.getEntries();
  const lines = [
    "# Ampersand Bridge for GitHub Copilot diagnostics",
    "",
    `- VS Code: ${vscode.version}`,
    `- API endpoint: ${API_BASE}`,
    "- Service: ai& hosted API (independent extension, not affiliated with ai&)",
    `- Native entries: ${entries.length ? entries.map(({ entryId }) => entryId).join(", ") : "none"}`,
    `- Default reasoning effort: ${vscode.workspace.getConfiguration("ampersandBridge").get("reasoningEffort", "high")}`,
    `- Registered models: ${models.length}`,
    "",
    ...models.map((model) => `- ${model.id} (${model.maxInputTokens} input tokens)`),
  ];
  output.appendLine(`[diagnostics] models=${models.length}`);
  const doc = await vscode.workspace.openTextDocument({
    content: lines.join("\n"),
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}
