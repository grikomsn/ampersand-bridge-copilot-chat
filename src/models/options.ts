import type { ContextSizeOption } from "../kit/context-size";

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
