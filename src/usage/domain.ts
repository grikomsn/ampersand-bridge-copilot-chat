export interface AccountAllowance {
  readonly credits?: number;
  readonly currency?: "usd" | "jpy";
  readonly usableRequests?: number | null;
}
export interface RequestUsage {
  readonly modelId: string;
  readonly recordedAt: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly cost?: number;
}
export interface TrackedUsage {
  readonly requests: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly cost: number;
}
export interface AmpersandUsageSnapshot {
  readonly account?: AccountAllowance;
  readonly lastRequest?: RequestUsage;
  readonly tracked?: TrackedUsage;
  readonly updatedAt?: number;
  readonly error?: string;
}
export interface ProviderUsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
  copilotCredits?: number;
}
export interface UsageDisplayRow {
  readonly kind: "credits" | "allowance" | "tracked" | "request" | "warning" | "empty";
  readonly label: string;
  readonly description: string;
  readonly detail?: string;
}

export function accountUsageFromPayload(raw: unknown): AccountAllowance | undefined {
  if (!isRecord(raw)) return undefined;
  const credits = finiteNumber(raw.balance ?? raw.credits);
  const currency = raw.currency === "usd" || raw.currency === "jpy" ? raw.currency : undefined;
  const usableRequests = raw.usable_requests === null ? null : finiteNumber(raw.usable_requests);
  if (credits === undefined && usableRequests === undefined) return undefined;
  return {
    ...(credits === undefined ? {} : { credits }),
    ...(currency === undefined ? {} : { currency }),
    ...(usableRequests === undefined ? {} : { usableRequests }),
  };
}

export function mergeAccountUsage(current: AmpersandUsageSnapshot, raw: unknown, updatedAt = Date.now()): AmpersandUsageSnapshot {
  const account = accountUsageFromPayload(raw);
  return account
    ? { ...current, account, updatedAt, error: undefined }
    : {
        ...current,
        updatedAt,
        error: "Ampersand Bridge returned invalid account usage data",
      };
}

export function recordRequestUsage(
  current: AmpersandUsageSnapshot,
  raw: Record<string, unknown>,
  modelId: string,
  recordedAt = Date.now(),
): AmpersandUsageSnapshot {
  const usage = normalizeUsage(raw);
  return {
    ...current,
    lastRequest: { modelId, recordedAt, ...usage },
    tracked: {
      requests: (current.tracked?.requests ?? 0) + 1,
      promptTokens: (current.tracked?.promptTokens ?? 0) + (usage.promptTokens ?? 0),
      completionTokens: (current.tracked?.completionTokens ?? 0) + (usage.completionTokens ?? 0),
      totalTokens: (current.tracked?.totalTokens ?? 0) + (usage.totalTokens ?? 0),
      cachedTokens: (current.tracked?.cachedTokens ?? 0) + (usage.cachedTokens ?? 0),
      reasoningTokens: (current.tracked?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
      cost: (current.tracked?.cost ?? 0) + (usage.cost ?? 0),
    },
    updatedAt: recordedAt,
  };
}

export function toProviderUsagePayload(raw: Record<string, unknown>): ProviderUsagePayload {
  const usage = normalizeUsage(raw);
  return {
    ...(usage.promptTokens === undefined ? {} : { prompt_tokens: usage.promptTokens }),
    ...(usage.completionTokens === undefined ? {} : { completion_tokens: usage.completionTokens }),
    ...(usage.totalTokens === undefined ? {} : { total_tokens: usage.totalTokens }),
    ...(usage.cachedTokens === undefined ? {} : { prompt_tokens_details: { cached_tokens: usage.cachedTokens } }),
    ...(usage.reasoningTokens === undefined
      ? {}
      : {
          completion_tokens_details: {
            reasoning_tokens: usage.reasoningTokens,
          },
        }),
    ...(usage.cost === undefined ? {} : { copilotCredits: usage.cost }),
  };
}

export function formatUsageStatusBar(snapshot: AmpersandUsageSnapshot): string {
  if (snapshot.account?.credits !== undefined)
    return `$(credit-card) Ampersand Bridge ${formatBalance(snapshot.account.credits, snapshot.account.currency)}`;
  if (snapshot.account?.usableRequests !== undefined && snapshot.account.usableRequests !== null)
    return `$(pulse) Ampersand Bridge ${compactCount(snapshot.account.usableRequests)} req`;
  if (snapshot.error) return "$(warning) Ampersand Bridge usage";
  return "$(cloud) Ampersand Bridge";
}

export function formatUsageTooltip(snapshot: AmpersandUsageSnapshot): string {
  const lines = ["Ampersand Bridge account balance and API activity"];
  if (snapshot.account?.credits !== undefined)
    lines.push(`Credit balance: ${formatBalance(snapshot.account.credits, snapshot.account.currency)}`);
  if (snapshot.account?.usableRequests === null) lines.push("Daily request allowance: pay-as-you-go account");
  else if (snapshot.account?.usableRequests !== undefined)
    lines.push(`Requests left today: ${snapshot.account.usableRequests.toLocaleString()}`);
  if (snapshot.tracked)
    lines.push(
      `Tracked locally: ${snapshot.tracked.totalTokens.toLocaleString()} tokens across ${snapshot.tracked.requests.toLocaleString()} requests`,
    );
  if (snapshot.error) lines.push(`Last refresh failed: ${snapshot.error}`);
  if (snapshot.updatedAt) lines.push(`Updated: ${new Date(snapshot.updatedAt).toLocaleString()}`);
  lines.push("Click for details");
  return lines.join("\n");
}

export function formatUsageRows(snapshot: AmpersandUsageSnapshot): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  if (snapshot.account?.credits !== undefined)
    rows.push({
      kind: "credits",
      label: "Credit balance",
      description: formatBalance(snapshot.account.credits, snapshot.account.currency),
      detail: "Available pay-as-you-go Ampersand Bridge credits",
    });
  if (snapshot.account?.usableRequests !== undefined)
    rows.push({
      kind: "allowance",
      label: "Daily request allowance",
      description:
        snapshot.account.usableRequests === null
          ? "Not limited by a subscription allowance"
          : `${snapshot.account.usableRequests.toLocaleString()} requests left today`,
    });
  if (snapshot.tracked)
    rows.push({
      kind: "tracked",
      label: "Tracked by this extension",
      description: `${snapshot.tracked.totalTokens.toLocaleString()} tokens across ${snapshot.tracked.requests.toLocaleString()} requests`,
      detail: `${snapshot.tracked.promptTokens.toLocaleString()} input · ${snapshot.tracked.completionTokens.toLocaleString()} output · $${formatMoney(
        snapshot.tracked.cost,
      )} reported cost`,
    });
  if (snapshot.lastRequest)
    rows.push({
      kind: "request",
      label: "Last inference",
      description: `${(snapshot.lastRequest.totalTokens ?? 0).toLocaleString()} tokens`,
      detail: `${snapshot.lastRequest.modelId} · ${new Date(snapshot.lastRequest.recordedAt).toLocaleString()}`,
    });
  if (snapshot.error)
    rows.push({
      kind: "warning",
      label: "Usage refresh failed",
      description: snapshot.error,
    });
  if (!rows.length)
    rows.push({
      kind: "empty",
      label: "Usage not loaded",
      description: "Configure an API key or refresh usage",
    });
  return rows;
}

function normalizeUsage(raw: Record<string, unknown>): Omit<RequestUsage, "modelId" | "recordedAt"> {
  const promptTokens = finiteNumber(raw.prompt_tokens ?? raw.input_tokens);
  const completionTokens = finiteNumber(raw.completion_tokens ?? raw.output_tokens);
  const totalTokens =
    finiteNumber(raw.total_tokens) ??
    (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
  const promptDetails = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : undefined;
  const completionDetails = isRecord(raw.completion_tokens_details) ? raw.completion_tokens_details : undefined;
  const rawCost = isRecord(raw.cost) ? raw.cost.total ?? raw.cost.usd : raw.cost;
  const cachedTokens = finiteNumber(promptDetails?.cached_tokens);
  const reasoningTokens = finiteNumber(completionDetails?.reasoning_tokens);
  const cost = finiteNumber(rawCost);
  return {
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cost === undefined ? {} : { cost }),
  };
}

function formatMoney(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "") || "0";
}
function formatBalance(value: number, currency: AccountAllowance["currency"]): string {
  const amount = formatMoney(value);
  if (currency === "jpy") return `¥${amount}`;
  return `$${amount}`;
}
function compactCount(value: number): string {
  return value >= 1_000 ? `${Number((value / 1_000).toFixed(1))}K` : value.toLocaleString();
}
function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
