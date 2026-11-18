import { MODELS_DEV_API_URL, MODELS_DEV_CACHE_TTL_MS, RemoteSnapshot, type SnapshotStore } from "../kit/remote-snapshot";

export { MODELS_DEV_API_URL, MODELS_DEV_CACHE_TTL_MS };
export const MODELS_DEV_CACHE_KEY = "ampersandBridge.modelsDevMetadata.v1";

export interface ModelsDevModelMetadata {
  readonly id: string;
  readonly description?: string;
  readonly contextLength?: number;
  readonly maxOutputTokens?: number;
  readonly imageInput?: boolean;
  readonly toolCalling?: boolean;
  readonly reasoning?: boolean;
  readonly reasoningOptions?: readonly string[];
  readonly releaseDate?: string;
}
export interface ModelsDevSnapshot {
  readonly fetchedAt: number;
  readonly models: Readonly<Record<string, ModelsDevModelMetadata>>;
}
export type MetadataCache = SnapshotStore;

export function normalizeModelsDevSnapshot(payload: unknown, fetchedAt: number): ModelsDevSnapshot {
  const models = record(record(record(payload)?.aiand)?.models);
  if (!models) throw new Error("Models.dev returned no Ampersand Bridge model catalog");
  const normalized = Object.fromEntries(
    Object.entries(models).flatMap(([key, value]) => {
      const model = normalizeModel(key, value);
      return model ? [[model.id, model]] : [];
    }),
  );
  if (!Object.keys(normalized).length) throw new Error("Models.dev returned no usable Ampersand Bridge models");
  return { fetchedAt, models: normalized };
}

export function parseCachedModelsDevSnapshot(value: unknown): ModelsDevSnapshot | undefined {
  const raw = record(value);
  const models = record(raw?.models);
  if (!raw || !number(raw.fetchedAt) || !models) return undefined;
  try {
    return normalizeCachedModels(models, raw.fetchedAt as number);
  } catch {
    return undefined;
  }
}

/** models.dev enrichment with the kit's persisted stale-while-revalidate lifecycle. */
export class ModelsDevMetadata extends RemoteSnapshot<ModelsDevSnapshot> {
  constructor(cache: MetadataCache, fetchImpl: typeof fetch = fetch, now: () => number = () => Date.now()) {
    super({
      cacheKey: MODELS_DEV_CACHE_KEY,
      store: cache,
      fetch: fetchImpl,
      now,
      normalize: normalizeModelsDevSnapshot,
      parseCached: parseCachedModelsDevSnapshot,
      empty: () => ({ fetchedAt: 0, models: {} }),
    });
  }
}

function normalizeModel(key: string, value: unknown): ModelsDevModelMetadata | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const id = text(raw.id) ?? key.trim();
  if (!id) return undefined;
  const limit = record(raw.limit);
  const modalities = record(raw.modalities);
  const input = strings(modalities?.input);
  const options = reasoningOptions(raw.reasoning_options);
  return {
    id,
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    ...(positive(limit?.context) ? { contextLength: positive(limit?.context) } : {}),
    ...(positive(limit?.output) ? { maxOutputTokens: positive(limit?.output) } : {}),
    ...(input.length ? { imageInput: input.includes("image") } : {}),
    ...(typeof raw.tool_call === "boolean" ? { toolCalling: raw.tool_call } : {}),
    ...(typeof raw.reasoning === "boolean" ? { reasoning: raw.reasoning } : {}),
    ...(options ? { reasoningOptions: options } : {}),
    ...(text(raw.release_date) ? { releaseDate: text(raw.release_date) } : {}),
  };
}

function normalizeCachedModels(models: Record<string, unknown>, fetchedAt: number): ModelsDevSnapshot {
  const parsed: Record<string, ModelsDevModelMetadata> = {};
  for (const [key, value] of Object.entries(models)) {
    const model = normalizeModel(key, cachedToRaw(value));
    if (!model) throw new Error("invalid cache");
    parsed[model.id] = model;
  }
  return { fetchedAt, models: parsed };
}
function cachedToRaw(value: unknown): unknown {
  const raw = record(value);
  return raw
    ? {
        id: raw.id,
        description: raw.description,
        limit: { context: raw.contextLength, output: raw.maxOutputTokens },
        modalities: {
          input: raw.imageInput === true ? ["text", "image"] : raw.imageInput === false ? ["text"] : [],
        },
        tool_call: raw.toolCalling,
        reasoning: raw.reasoning,
        reasoning_options: Array.isArray(raw.reasoningOptions)
          ? [{ type: "effort", values: raw.reasoningOptions }]
          : undefined,
        release_date: raw.releaseDate,
      }
    : value;
}
function reasoningOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = [
    ...new Set(
      value.flatMap((entry) => {
        const item = record(entry);
        return item?.type === "effort" ? strings(item.values) : [];
      }),
    ),
  ];
  return result.length ? result : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
function number(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
