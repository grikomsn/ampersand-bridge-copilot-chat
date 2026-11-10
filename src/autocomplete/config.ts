/**
 * Configuration surface for experimental inline code suggestions.
 *
 * Suggestions are strictly opt-in: `ampersandBridge.inlineSuggestions` defaults
 * to false and the provider checks the setting live on every request, so
 * toggling needs no reload.
 */

export const CONFIG_SECTION = "ampersandBridge";

export const INLINE_SUGGESTIONS_SETTING = "inlineSuggestions";
export const INLINE_SUGGESTIONS_MODEL_SETTING = "inlineSuggestionsModel";
export const INLINE_SUGGESTIONS_CHAT_INPUT_SETTING = "inlineSuggestionsChatInput";
export const INLINE_DEBOUNCE_MS_SETTING = "inlineSuggestionsDebounceMs";
export const INLINE_TIMEOUT_MS_SETTING = "inlineSuggestionsTimeoutMs";
export const INLINE_MAX_TOKENS_SETTING = "inlineSuggestionsMaxTokens";
export const INLINE_PREFIX_LINES_SETTING = "inlineSuggestionsPrefixLines";
export const INLINE_SUFFIX_CHARS_SETTING = "inlineSuggestionsSuffixChars";

/**
 * Sensible low-latency default for inline suggestions.
 *
 * `deepseek-ai/deepseek-v4.1-flash` reached end of support on 2026-11-06, so
 * the default points at its replacement, `deepseek-ai/deepseek-v4.1-flash-1017`.
 */
export const DEFAULT_INLINE_MODEL = "deepseek-ai/deepseek-v4.1-flash-1017";

// The model picker writes its choice to Global settings even when it matches
// the package.json default, so a default change never reaches those users.
// Retired ids fall back to the new default instead of failing silently.
const RETIRED_INLINE_MODELS = new Set([
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4.1-flash",
  "moonshotai/kimi-k2.7-code",
  "zai-org/glm-5.2",
]);

/** The configured inline model, with retired ids moved to the default. */
export function inlineModelId(configured: string | undefined): string {
  const id = configured?.trim();
  return !id || RETIRED_INLINE_MODELS.has(id.toLowerCase()) ? DEFAULT_INLINE_MODEL : id;
}
export const DEFAULT_INLINE_DEBOUNCE_MS = 300;
export const DEFAULT_INLINE_TIMEOUT_MS = 3_000;
export const DEFAULT_INLINE_MAX_TOKENS = 128;
export const DEFAULT_INLINE_PREFIX_LINES = 10;
export const DEFAULT_INLINE_SUFFIX_CHARS = 300;
export const DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT = false;

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
