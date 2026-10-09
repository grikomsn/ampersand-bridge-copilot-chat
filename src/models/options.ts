export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";

/** The reasoning-effort options a single model actually accepts. */
export interface ModelEffortSpec {
  readonly efforts: readonly ReasoningEffort[];
  readonly defaultEffort: ReasoningEffort;
}

/**
 * Builds the effort spec for a model from its supported-effort list and default.
 * Returns undefined when the model does not accept a reasoning effort at all.
 */
export function modelEffortSpec(
  efforts: readonly ReasoningEffort[] | undefined,
  defaultEffort?: ReasoningEffort,
): ModelEffortSpec | undefined {
  if (!efforts?.length) return undefined;
  const clean = efforts.filter(isReasoningEffort);
  if (!clean.length) return undefined;
  return {
    efforts: clean,
    defaultEffort: defaultEffort && clean.includes(defaultEffort) ? defaultEffort : clean.at(-1)!,
  };
}

/**
 * Resolves the effective reasoning effort for a request.
 * Precedence: picker selection → workspace default → the model's own default.
 * The result is always a member of the model's supported list.
 */
export function resolveReasoningEffort(
  spec: ModelEffortSpec | undefined,
  requestConfiguration: Readonly<Record<string, unknown>> | undefined,
  workspaceDefault: unknown,
): ReasoningEffort | undefined {
  if (!spec) return undefined;
  const requested = stringOption(requestConfiguration, "reasoningEffort")
    ?? stringOption(requestConfiguration, "thinkingEffort")
    ?? (typeof workspaceDefault === "string" ? workspaceDefault : undefined);
  return spec.efforts.includes(requested as ReasoningEffort)
    ? requested as ReasoningEffort
    : spec.defaultEffort;
}

/** A selectable context window tier shown on a model's picker configuration. */
export interface ContextSizeOption {
  /** Context cap in input tokens; "auto" selects the model's default handling. */
  readonly value: number | "auto";
  /** Short picker label, e.g. "Auto", "128K", or "Maximum". */
  readonly label: string;
  /** Picker description for the tier. */
  readonly description: string;
}

/** Fixed context tiers offered below a model's registered input limit. */
const CONTEXT_SIZE_TIERS: readonly { value: number; label: string }[] = [
  { value: 65_536, label: "64K" },
  { value: 131_072, label: "128K" },
  { value: 200_000, label: "200K" },
];

/** Builds the context window tiers offered for a model's input limit; undefined when no tier fits. */
export function contextSizeOptions(maxInputTokens: number): ContextSizeOption[] | undefined {
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= CONTEXT_SIZE_TIERS[0].value) return undefined;
  const tiers = CONTEXT_SIZE_TIERS.filter((tier) => tier.value < maxInputTokens);
  if (!tiers.length) return undefined;
  return [
    // VS Code treats every numeric contextSize, including zero, as an input budget.
    { value: "auto", label: "Auto", description: "Default context handling for this model." },
    ...tiers.map((tier) => ({
      value: tier.value,
      label: tier.label,
      description: `Keep the conversation under ${tier.label} input tokens.`,
    })),
    {
      value: maxInputTokens,
      label: "Maximum",
      description: "Use the model's full available input limit.",
    },
  ];
}

/** Resolves the effective context cap for a request; Auto and Maximum return undefined. */
export function resolveContextCap(contextSize: number, maxInputTokens: number): number | undefined {
  if (!Number.isFinite(contextSize) || contextSize <= 0) return undefined;
  if (!Number.isFinite(maxInputTokens) || maxInputTokens <= 0) return undefined;
  const cap = Math.min(Math.floor(contextSize), maxInputTokens);
  return cap < maxInputTokens ? cap : undefined;
}

/** Reads the opted-in context size from picker configuration; 0 keeps the model's default handling. */
export function resolveContextSize(requestConfiguration: Readonly<Record<string, unknown>> | undefined): number {
  const value = requestConfiguration?.contextSize;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function buildModelConfigurationSchema(
  effortSpec: ModelEffortSpec | undefined,
  contextOptions?: readonly ContextSizeOption[],
): {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
} | undefined {
  if (!effortSpec && !contextOptions?.length) return undefined;
  return {
    type: "object",
    properties: {
      ...(effortSpec ? {
        reasoningEffort: {
          type: "string",
          title: "Reasoning Effort",
          enum: [...effortSpec.efforts],
          enumItemLabels: effortSpec.efforts.map(formatEffortLabel),
          enumDescriptions: effortSpec.efforts.map(effortDescription),
          default: effortSpec.defaultEffort,
          group: "navigation",
        },
      } : {}),
      ...(contextOptions?.length ? {
        contextSize: {
          type: ["string", "number"],
          title: "Context Window",
          enum: contextOptions.map((option) => option.value),
          enumItemLabels: contextOptions.map((option) => option.label),
          enumDescriptions: contextOptions.map((option) => option.description),
          default: "auto",
          group: "tokens",
        },
      } : {}),
    },
  };
}

/**
 * Applies a validated reasoning effort to the request body.
 * The effort must already be a member of the model's supported list; pass
 * undefined to omit the field entirely (models without reasoning control).
 */
export function applyReasoningEffort(
  body: Readonly<Record<string, unknown>>,
  effort: ReasoningEffort | undefined,
): Record<string, unknown> {
  return effort ? { ...body, reasoning_effort: effort } : { ...body };
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);
}

function stringOption(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] as string : undefined;
}

function formatEffortLabel(value: ReasoningEffort): string {
  if (value === "xhigh") return "Extra High";
  if (value === "max") return "Max";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function effortDescription(value: ReasoningEffort): string {
  switch (value) {
    case "none": return "Disable model reasoning";
    case "low": return "Use less reasoning for lower latency and cost";
    case "medium": return "Balance reasoning depth, latency, and cost";
    case "high": return "Use deeper reasoning for complex tasks";
    case "xhigh": return "Use substantially deeper reasoning for the hardest tasks";
    case "max": return "Use the model's maximum available reasoning";
  }
}
