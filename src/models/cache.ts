import type { AmpersandModelMetadata } from "./catalog";

export function parseCatalogSnapshots(value: unknown): Record<string, AmpersandModelMetadata[]> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([credentialRef, raw]) => {
      if (!Array.isArray(raw)) return [];
      const models = raw.flatMap((entry) => (validModel(entry) ? [entry] : []));
      return models.length === raw.length ? [[credentialRef, models]] : [];
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
