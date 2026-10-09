import { ampersandModelCost, modelCostFromApi, type ModelCost } from "./pricing";
import type { ModelsDevModelMetadata } from "./metadata";
import type { ReasoningEffort } from "./options";

export const FALLBACK_MODELS = [
  "openai/gpt-oss-120b",
  "deepseek-ai/deepseek-v4.1-flash",
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro",
  "moonshotai/kimi-k3",
  "moonshotai/kimi-k2.7-code",
  "zai-org/glm-5.3-flash",
  "zai-org/glm-5.3",
  "zai-org/glm-5.2",
  "google/gemma-4-31b-it",
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
  "motif-technologies/motif-3",
] as const;

export const DEFAULT_MAX_INPUT_TOKENS = 262_144;
export const DEFAULT_MAX_OUTPUT_TOKENS = 131_072;

/**
 * Fallback per-model reasoning efforts captured from the live Ampersand Bridge catalog
 * (`GET /v1/models` `reasoning_efforts` / `reasoning_effort_default`).
 * The live response stays authoritative; these keep the picker accurate when
 * the catalog is unavailable. Models absent here have no reasoning control.
 */
const FALLBACK_REASONING_EFFORTS: Readonly<Record<string, {
  readonly efforts: readonly ReasoningEffort[];
  readonly defaultEffort: ReasoningEffort;
}>> = {
  "openai/gpt-oss-120b": { efforts: ["low", "medium", "high"], defaultEffort: "medium" },
  "deepseek-ai/deepseek-v4.1-flash": { efforts: ["none", "high", "max"], defaultEffort: "high" },
  "deepseek-ai/deepseek-v4-flash": { efforts: ["none", "high", "max"], defaultEffort: "high" },
  "deepseek-ai/deepseek-v4-pro": { efforts: ["none", "high", "max"], defaultEffort: "high" },
  "moonshotai/kimi-k3": { efforts: ["low", "high", "max"], defaultEffort: "max" },
  "moonshotai/kimi-k2.7-code": { efforts: ["high"], defaultEffort: "high" },
  "zai-org/glm-5.3-flash": { efforts: ["low", "high", "max"], defaultEffort: "max" },
  "zai-org/glm-5.3": { efforts: ["low", "high", "max"], defaultEffort: "max" },
  "zai-org/glm-5.2": { efforts: ["none", "high", "max"], defaultEffort: "max" },
  "google/gemma-4-31b-it": { efforts: ["none", "high"], defaultEffort: "none" },
  "qwen/qwen3.8-27b": { efforts: ["none", "low", "medium", "xhigh"], defaultEffort: "xhigh" },
  "qwen/qwen3.6-27b": { efforts: ["none", "high"], defaultEffort: "high" },
  "motif-technologies/motif-3": { efforts: ["none", "high"], defaultEffort: "high" },
};

export interface AmpersandModelMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly contextLength: number;
  readonly maxOutputTokens: number;
  readonly imageInput: boolean;
  readonly toolCalling: boolean;
  /** Reasoning efforts the model accepts; undefined when it has no reasoning control. */
  readonly reasoningEfforts?: readonly ReasoningEffort[];
  /** The model's own default reasoning effort; must be a member of reasoningEfforts. */
  readonly defaultReasoningEffort?: ReasoningEffort;
  readonly description?: string;
  readonly releaseDate?: string;
  readonly cost?: ModelCost;
}

export interface AmpersandApiModel {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly version?: unknown;
  readonly context_window?: unknown;
  readonly context_length?: unknown;
  readonly max_context_tokens?: unknown;
  readonly max_model_len?: unknown;
  readonly max_output_tokens?: unknown;
  readonly max_completion_tokens?: unknown;
  readonly capabilities?: unknown;
  readonly input_modalities?: unknown;
  readonly architecture?: unknown;
  readonly pricing?: unknown;
  readonly input_per_1m?: unknown;
  readonly output_per_1m?: unknown;
  readonly cached_input_per_1m?: unknown;
  readonly tool_calling?: unknown;
  readonly tool_call?: unknown;
  readonly reasoning_effort?: unknown;
  readonly reasoning_efforts?: unknown;
  readonly reasoning_effort_default?: unknown;
  readonly custom_reasoning?: unknown;
  readonly description?: unknown;
  readonly created?: unknown;
}

const OFFICIAL_MODEL_NAMES: Readonly<Record<string, string>> = {
  "openai/gpt-oss-120b": "GPT OSS 120B",
  "deepseek-ai/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "deepseek-ai/deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-ai/deepseek-v4-pro": "DeepSeek V4 Pro",
  "moonshotai/kimi-k3": "Kimi K3",
  "moonshotai/kimi-k2.7-code": "Kimi K2.7 Code",
  "zai-org/glm-5.3-flash": "GLM 5.3 Flash",
  "zai-org/glm-5.3": "GLM 5.3",
  "zai-org/glm-5.2": "GLM 5.2",
  "google/gemma-4-31b-it": "Gemma 4 31B IT",
  "qwen/qwen3.8-27b": "Qwen 3.8 27B",
  "qwen/qwen3.6-27b": "Qwen 3.6 27B",
  "motif-technologies/motif-3": "Motif 3",
};

const VENDOR_LABELS: Readonly<Record<string, string>> = {
  "deepseek-ai": "DeepSeek",
  openai: "OpenAI",
  moonshotai: "Kimi",
  "zai-org": "GLM",
  google: "Google",
  qwen: "Qwen",
  "motif-technologies": "Motif",
};

export const FALLBACK_MODEL_METADATA: readonly AmpersandModelMetadata[] = [
  model("openai/gpt-oss-120b", 131_072, 32_768),
  model("deepseek-ai/deepseek-v4.1-flash", 1_048_576, 384_000, true),
  model("deepseek-ai/deepseek-v4-flash", 1_048_576, 384_000),
  model("deepseek-ai/deepseek-v4-pro", 1_048_576, 384_000),
  model("moonshotai/kimi-k3", 1_048_576, 131_072, true),
  model("moonshotai/kimi-k2.7-code", 262_144, 262_144, true),
  model("zai-org/glm-5.3-flash", 1_048_550, 131_072, true),
  model("zai-org/glm-5.3", 1_048_576, 131_072),
  model("zai-org/glm-5.2", 1_048_576, 131_072),
  model("google/gemma-4-31b-it", 262_144, 32_768, true),
  model("qwen/qwen3.8-27b", 262_144, 32_768, true),
  model("qwen/qwen3.6-27b", 262_144, 65_536, true),
  model("motif-technologies/motif-3", 262_144, 262_144),
];

const PREFERRED_ORDER = new Map<string, number>(FALLBACK_MODELS.map((id, index) => [id, index]));
const FALLBACK_METADATA_BY_ID = new Map(FALLBACK_MODEL_METADATA.map((metadata) => [metadata.id, metadata]));

export function isAmpersandChatModel(id: string): boolean {
  const value = id.trim().toLowerCase();
  return Boolean(value) && !/(?:^|[-/])(point|embed(?:ding)?s?|image|video|audio|voice|rerank)(?:[-/.]|$)/.test(value);
}

export function orderModels(ids: readonly string[]): string[] {
  return [...new Set(ids.map(canonicalModelId))].filter(isAmpersandChatModel).sort((left, right) => {
    const leftRank = PREFERRED_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = PREFERRED_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.localeCompare(right);
  });
}

export function getModelMetadata(id: string): AmpersandModelMetadata {
  const canonical = canonicalModelId(id);
  return (
    FALLBACK_METADATA_BY_ID.get(canonical) ?? model(canonical, DEFAULT_MAX_INPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS)
  );
}

export function resolveMaxOutputTokens(configured: number, advertised: number): number {
  return configured > 0 ? Math.min(configured, advertised) : advertised;
}

/** Parse a successful discovery separately from the fallback used on fetch failures. */
export function modelCatalogFromApi(
  payload: unknown,
  enrichment: Readonly<Record<string, ModelsDevModelMetadata>> = {},
): AmpersandModelMetadata[] {
  const body = record(payload);
  if (!Array.isArray(body?.data)) throw new Error("Ampersand Bridge returned an invalid model catalog");
  return orderModelMetadata(body.data, enrichment);
}

export function orderModelMetadata(
  models: readonly unknown[],
  enrichment: Readonly<Record<string, ModelsDevModelMetadata>> = {},
): AmpersandModelMetadata[] {
  const discovered = new Map<string, AmpersandModelMetadata>();
  for (const raw of models) {
    const candidate = record(raw);
    if (!candidate) continue;
    const metadata = modelMetadataFromApi(candidate, enrichment);
    if (metadata && !discovered.has(metadata.id)) discovered.set(metadata.id, metadata);
  }
  return orderModels([...discovered.keys()]).flatMap((id) => {
    const metadata = discovered.get(id);
    return metadata ? [metadata] : [];
  });
}

/** Maps external reasoning-option strings onto the canonical ReasoningEffort list, preserving order. */
function normalizeReasoningEfforts(value: readonly string[] | undefined): ReasoningEffort[] | undefined {
  if (!value?.length) return undefined;
  const result = value.filter((entry): entry is ReasoningEffort =>
    (REASONING_EFFORTS_LIST as readonly string[]).includes(entry));
  return result.length ? result : undefined;
}

const REASONING_EFFORTS_LIST: readonly ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

export function formatTokenLimit(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1024) return `${Math.round(tokens / 1024)}K`;
  return `${tokens}`;
}

export function formatModelName(id: string): string {
  const canonical = canonicalModelId(id);
  const official = OFFICIAL_MODEL_NAMES[canonical];
  if (official) return official;
  // Ampersand Bridge ids are namespaced as `provider/model` (e.g. `qwen/qwen3.8-27b`).
  const namespaced = canonical.split("/");
  const vendor = VENDOR_LABELS[namespaced[0] ?? ""];
  const modelPart = namespaced.length > 1 ? namespaced.slice(1).join("-") : canonical;
  const parts = modelPart.split("-");
  // Strip exact family tokens, preserving embedded versions such as qwen3.9.
  const family = parts[0]?.toLowerCase();
  const rest = vendor && (family === namespaced[0].split("-")[0] || family === vendor.toLowerCase())
    ? parts.slice(1)
    : parts;
  // Qwen families embed the version in the family name (qwen3.8) and keep the
  // parameter count together (27b), so render the family and model separately.
  if (parts[0]?.startsWith("qwen") && parts[0] !== "qwen") {
    const [family, ...tail] = parts;
    return `${family.charAt(0).toUpperCase() + family.slice(1)} ${
      tail
        .map((part) => (/\d+b$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
        .join(" ")
    }`.trim();
  }
  return `${vendor ?? ""} ${formatModelLabel(rest)}`.trim();
}

function formatModelLabel(parts: string[]): string {
  return parts
    .map((part) => {
      if (/^(ai|glm|kimi|mimo|qwen|oss|vl|it|v\d+(?:\.\d+)?|k2\.\d|k3|120b|27b|31b|9b)$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function modelMetadataFromApi(
  raw: AmpersandApiModel,
  enrichment: Readonly<Record<string, ModelsDevModelMetadata>>,
): AmpersandModelMetadata | undefined {
  if (typeof raw.id !== "string" || !isAmpersandChatModel(raw.id)) return undefined;
  const id = canonicalModelId(raw.id);
  const fallback = FALLBACK_METADATA_BY_ID.get(id);
  const metadata = enrichment[id];
  const architecture = record(raw.architecture);
  const capabilities = stringArray(raw.capabilities);
  const modalities = stringArray(raw.input_modalities) ?? stringArray(architecture?.input_modalities);
  const rawName = typeof raw.name === "string" ? raw.name : "";
  const apiName = rawName.trim().replace(/^Ampersand Bridge:\s*/i, "").trim();
  const capabilitySet = new Set((capabilities ?? []).map((value) => value.toLowerCase()));
  // The live reasoning_efforts list is authoritative for what the model accepts.
  const liveEfforts = stringArray(raw.reasoning_efforts);
  const liveReasoning = boolean(raw.reasoning_effort) ?? boolean(raw.custom_reasoning)
    ?? (capabilities === undefined ? undefined : capabilitySet.has("reasoning"));
  const reasoningEfforts = liveEfforts !== undefined
    ? normalizeReasoningEfforts(liveEfforts)
    : liveReasoning === false ? undefined
      : fallback?.reasoningEfforts ?? normalizeReasoningEfforts(metadata?.reasoningOptions);
  const liveDefault = isReasoningEffortValue(raw.reasoning_effort_default)
    ? raw.reasoning_effort_default
    : undefined;
  const defaultReasoningEffort = liveDefault && reasoningEfforts?.includes(liveDefault)
    ? liveDefault
    : fallback?.defaultReasoningEffort && reasoningEfforts?.includes(fallback.defaultReasoningEffort)
      ? fallback.defaultReasoningEffort : reasoningEfforts?.at(-1);
  const description = typeof raw.description === "string" && raw.description.trim()
    ? raw.description.trim() : metadata?.description;
  const releaseDate = unixDate(raw.created) ?? metadata?.releaseDate;
  return {
    id,
    name: OFFICIAL_MODEL_NAMES[id] ?? (apiName || formatModelName(id)),
    version: typeof raw.version === "string" && raw.version ? raw.version : "unknown",
    contextLength:
      liveContextLength(raw) ?? fallback?.contextLength ?? positiveInteger(metadata?.contextLength) ?? DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens: positiveInteger(raw.max_completion_tokens) ?? positiveInteger(raw.max_output_tokens)
      ?? fallback?.maxOutputTokens ?? positiveInteger(metadata?.maxOutputTokens) ?? DEFAULT_MAX_OUTPUT_TOKENS,
    imageInput:
      capabilities !== undefined
        ? capabilitySet.has("vision")
        : (modalities?.some((value) => value.toLowerCase() === "image")
          ?? fallback?.imageInput ?? metadata?.imageInput
          ?? (/(?:vision|\bvl\b)/i.test(rawName) || /(?:^|[-/])vision(?:[-/.]|$)/.test(id))),
    toolCalling:
      (capabilities === undefined ? undefined : capabilitySet.has("tool_calling"))
      ?? boolean(raw.tool_calling) ?? boolean(raw.tool_call)
      ?? fallback?.toolCalling ?? metadata?.toolCalling ?? true,
    ...(reasoningEfforts?.length ? { reasoningEfforts } : {}),
    ...(reasoningEfforts?.length && defaultReasoningEffort
      ? { defaultReasoningEffort }
      : {}),
    ...(description ? { description } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    cost: ampersandModelCost(id, modelCostFromApi(raw.pricing ?? pickPerMillionPricing(raw))),
  };
}

function isReasoningEffortValue(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS_LIST as readonly string[]).includes(value);
}

function model(id: string, contextLength: number, maxOutputTokens: number, imageInput = false): AmpersandModelMetadata {
  const reasoning = FALLBACK_REASONING_EFFORTS[id];
  return {
    id,
    name: formatModelName(id),
    version: "unknown",
    contextLength,
    maxOutputTokens,
    imageInput,
    toolCalling: true,
    ...(reasoning
      ? { reasoningEfforts: reasoning.efforts, defaultReasoningEffort: reasoning.defaultEffort }
      : {}),
    cost: ampersandModelCost(id),
  };
}

function canonicalModelId(id: string): string {
  return id.trim().toLowerCase();
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** A positive live shared window is authoritative, independent of output capability. */
function liveContextLength(raw: AmpersandApiModel): number | undefined {
  return positiveInteger(raw.context_window) ?? positiveInteger(raw.context_length)
    ?? positiveInteger(raw.max_context_tokens) ?? positiveInteger(raw.max_model_len);
}

/** Ampersand Bridge also reports flat `input_per_1m` / `output_per_1m` decimal strings; map them to pricing shape. */
function pickPerMillionPricing(raw: AmpersandApiModel): Record<string, unknown> | undefined {
  if (raw.input_per_1m === undefined && raw.output_per_1m === undefined) return undefined;
  return {
    prompt: raw.input_per_1m,
    completion: raw.output_per_1m,
    ...(raw.cached_input_per_1m === undefined ? {} : { cache_prompt: raw.cached_input_per_1m }),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
function unixDate(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

/** Separate output capability from the response budget reserved by the chat UI. */
export function advertisedModelLimits(
  model: Pick<AmpersandModelMetadata, "contextLength" | "maxOutputTokens">,
  configuredOutput = 0,
): { maxInputTokens: number; maxOutputTokens: number } {
  const requested = Number.isFinite(configuredOutput) && configuredOutput > 0
    ? Math.floor(configuredOutput)
    : 32_768;
  const output = Math.max(1, Math.min(model.maxOutputTokens, requested, model.contextLength - 1));
  return { maxInputTokens: Math.max(1, model.contextLength - output), maxOutputTokens: output };
}
