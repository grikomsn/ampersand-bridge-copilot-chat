import type { AmpersandModelMetadata } from "./catalog";
import { isRetiredModel } from "./catalog";

export function parseCatalogSnapshots(value: unknown): Record<string, AmpersandModelMetadata[]> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([credentialRef, raw]) => {
      if (!Array.isArray(raw)) return [];
      // A snapshot written before a model reached end of support can still hold
      // it. Retired ids are dropped on their own, without invalidating the
      // rest of the snapshot the way a malformed entry would.
      const models = raw.flatMap((entry) => (validModel(entry) ? [entry] : []));
      if (models.length !== raw.length) return [];
      // Retired ids are dropped on their own, without invalidating the rest of
      // the snapshot the way a malformed entry would.
      return [[credentialRef, models.filter((model) => !isRetiredModel(model.id))]];
    }),
  );
}

function validModel(value: unknown): value is AmpersandModelMetadata {
  if (!record(value)) return false;
  const reasoningOk = value.reasoningEfforts === undefined
    || (Array.isArray(value.reasoningEfforts) && value.reasoningEfforts.every((e) => typeof e === "string"));
  return (
    typeof value.id === "string" &&
    Boolean(value.id) &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    positive(value.contextLength) &&
    positive(value.maxOutputTokens) &&
    typeof value.imageInput === "boolean" &&
    typeof value.toolCalling === "boolean" &&
    reasoningOk
  );
}

function positive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
