import * as vscode from "vscode";
import { registerInlineCompletions } from "./autocomplete";
import { registerCommands } from "./commands/commands";
import { AmpersandProvider } from "./provider";
import { extensionUserAgent } from "./transport/protocol";
import type { AmpersandUsageSnapshot } from "./usage/domain";
import { renderUsageStatus } from "./usage/presentation";

/** GlobalState key holding the persisted usage snapshot. */
const USAGE_STATE_KEY = "ampersandBridge.entryUsage.v1";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Ampersand Bridge");
  // Restore only entry-scoped inference activity; credit balances stay in memory.
  const initialUsage = context.globalState.get<Record<string, AmpersandUsageSnapshot>>(USAGE_STATE_KEY) ?? {};
  const provider = new AmpersandProvider(
    output,
    extensionUserAgent(context.extension.packageJSON.version, vscode.version),
    context.globalState,
    initialUsage,
  );
  const usageStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  usageStatus.name = "Ampersand Bridge credit balance and API activity";
  usageStatus.command = "ampersandBridge.showUsage";
  renderUsageStatus(usageStatus, provider.getSelectedUsageSnapshot());
  updateUsageStatusVisibility(usageStatus);

  context.subscriptions.push(
    output,
    usageStatus,
    provider.onDidChangeUsage((usage) => {
      renderUsageStatus(usageStatus, usage);
      updateUsageStatusVisibility(usageStatus);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("ampersandBridge.reasoningEffort") ||
        event.affectsConfiguration("ampersandBridge.catalogCacheMinutes") ||
        event.affectsConfiguration("ampersandBridge.managementEntry")
      ) {
        provider.fireDidChange();
      }
      if (event.affectsConfiguration("ampersandBridge.showUsageStatusBar")) {
        updateUsageStatusVisibility(usageStatus);
      }
    }),
    vscode.lm.registerLanguageModelChatProvider("ampersand-bridge", provider),
    ...registerCommands(provider, output, usageStatus),
    registerInlineCompletions(context, {
      resolveApiKey: async () => provider.getFeatureApiKey("inlineSuggestionsEntry"),
      resolveReasoningEfforts: (modelId) => provider.reasoningEffortsFor(modelId),
      output,
      version: context.extension.packageJSON.version as string,
      vscodeVersion: vscode.version,
    }),
  );

  output.appendLine(
    `[activate] Ampersand Bridge for Copilot Chat ${context.extension.packageJSON.version} on VS Code ${vscode.version}`,
  );
}

/** Shows or hides the usage status bar based on the `showUsageStatusBar` setting. */
function updateUsageStatusVisibility(item: vscode.StatusBarItem): void {
  if (vscode.workspace.getConfiguration("ampersandBridge").get("showUsageStatusBar", true)) item.show();
  else item.hide();
}
