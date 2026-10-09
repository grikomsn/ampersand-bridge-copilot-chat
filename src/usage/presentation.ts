/** Status bar rendering for Ampersand Bridge usage and credits. */

import * as vscode from "vscode";
import {
  formatUsageStatusBar,
  formatUsageTooltip,
  type AmpersandUsageSnapshot,
  type UsageDisplayRow,
} from "./domain";

/** A quick-pick entry that maps back to a usage command action. */
export interface UsageQuickPickItem extends vscode.QuickPickItem {
  /** Action to run when the entry is picked; `undefined` for info-only rows. */
  action?: "refresh" | "openApiKeys";
}

/**
 * Renders a usage snapshot into a status-bar item's text and tooltip.
 *
 * @example
 * const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
 * item.command = "ampersandBridge.showUsage";
 * renderUsageStatus(item, { account: { credits: 12.5, currency: "usd" } });
 * item.show();
 *
 * @see {@link formatUsageStatusBar}, {@link formatUsageTooltip}
 */
export function renderUsageStatus(item: vscode.StatusBarItem, snapshot: AmpersandUsageSnapshot): void {
  item.text = formatUsageStatusBar(snapshot);
  item.tooltip = formatUsageTooltip(snapshot);
}

/**
 * Converts a display row into a quick-pick item, prefixing the label with the
 * icon matching the row kind.
 *
 * @example
 * toUsageQuickPickItem({
 *   kind: "credits",
 *   label: "Credit balance",
 *   description: "$12.50",
 * });
 * // => { label: "$(credit-card) Credit balance", description: "$12.50", alwaysShow: true }
 *
 * @see {@link UsageDisplayRow}, {@link formatUsageRows}
 */
export function toUsageQuickPickItem(row: UsageDisplayRow): UsageQuickPickItem {
  const icon = {
    credits: "$(credit-card)",
    allowance: "$(calendar)",
    tracked: "$(symbol-numeric)",
    request: "$(history)",
    warning: "$(warning)",
    empty: "$(circle-slash)",
  }[row.kind];
  return {
    label: `${icon} ${row.label}`,
    description: row.description,
    detail: row.detail,
    alwaysShow: true,
  };
}
