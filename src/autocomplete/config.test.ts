import assert from "node:assert/strict";
import test from "node:test";
import {
  clampNumber,
  CONFIG_SECTION,
  DEFAULT_INLINE_DEBOUNCE_MS,
  DEFAULT_INLINE_MAX_TOKENS,
  DEFAULT_INLINE_MODEL,
  DEFAULT_INLINE_PREFIX_LINES,
  DEFAULT_INLINE_SUFFIX_CHARS,
  DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT,
  DEFAULT_INLINE_TIMEOUT_MS,
  INLINE_DEBOUNCE_MS_SETTING,
  INLINE_MAX_TOKENS_SETTING,
  INLINE_PREFIX_LINES_SETTING,
  INLINE_SUGGESTIONS_CHAT_INPUT_SETTING,
  INLINE_SUGGESTIONS_MODEL_SETTING,
  INLINE_SUGGESTIONS_SETTING,
  INLINE_SUFFIX_CHARS_SETTING,
  INLINE_TIMEOUT_MS_SETTING,
} from "./config";

test("keeps the configuration section and setting keys stable", () => {
  assert.equal(CONFIG_SECTION, "ampersandBridge");
  assert.equal(INLINE_SUGGESTIONS_SETTING, "inlineSuggestions");
  assert.equal(INLINE_SUGGESTIONS_MODEL_SETTING, "inlineSuggestionsModel");
  assert.equal(INLINE_SUGGESTIONS_CHAT_INPUT_SETTING, "inlineSuggestionsChatInput");
  assert.equal(INLINE_DEBOUNCE_MS_SETTING, "inlineSuggestionsDebounceMs");
  assert.equal(INLINE_TIMEOUT_MS_SETTING, "inlineSuggestionsTimeoutMs");
  assert.equal(INLINE_MAX_TOKENS_SETTING, "inlineSuggestionsMaxTokens");
  assert.equal(INLINE_PREFIX_LINES_SETTING, "inlineSuggestionsPrefixLines");
  assert.equal(INLINE_SUFFIX_CHARS_SETTING, "inlineSuggestionsSuffixChars");
});

test("uses the documented inline suggestion defaults", () => {
  // Low-latency flash-tier default; not live-benchmarked against Ampersand Bridge yet.
  assert.equal(DEFAULT_INLINE_MODEL, "deepseek-ai/deepseek-v4-flash");
  assert.equal(DEFAULT_INLINE_DEBOUNCE_MS, 300);
  assert.equal(DEFAULT_INLINE_TIMEOUT_MS, 3_000);
  assert.equal(DEFAULT_INLINE_MAX_TOKENS, 128);
  assert.equal(DEFAULT_INLINE_PREFIX_LINES, 10);
  assert.equal(DEFAULT_INLINE_SUFFIX_CHARS, 300);
  assert.equal(DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT, false);
});

test("returns the fallback for non-number values", () => {
  assert.equal(clampNumber(undefined, 300, 50, 2_000), 300);
  assert.equal(clampNumber(null, 300, 50, 2_000), 300);
  assert.equal(clampNumber("300", 300, 50, 2_000), 300);
  assert.equal(clampNumber(true, 300, 50, 2_000), 300);
  assert.equal(clampNumber({}, 300, 50, 2_000), 300);
});

test("returns the fallback for NaN and infinite values", () => {
  assert.equal(clampNumber(Number.NaN, 300, 50, 2_000), 300);
  assert.equal(clampNumber(Number.POSITIVE_INFINITY, 300, 50, 2_000), 300);
  assert.equal(clampNumber(Number.NEGATIVE_INFINITY, 300, 50, 2_000), 300);
});

test("clamps out-of-range numbers to the documented bounds", () => {
  assert.equal(clampNumber(-5, 300, 50, 2_000), 50);
  assert.equal(clampNumber(9_999, 300, 50, 2_000), 2_000);
  assert.equal(clampNumber(0, 300, 1, 100), 1);
  assert.equal(clampNumber(100_000, 128, 16, 1_024), 1_024);
});

test("floors fractional values before clamping", () => {
  assert.equal(clampNumber(150.9, 300, 50, 2_000), 150);
  assert.equal(clampNumber(10.9, 300, 50, 2_000), 50);
  assert.equal(clampNumber(-0.5, 300, 0, 5_000), 0);
  assert.equal(clampNumber(1_024.7, 128, 16, 1_024), 1_024);
});

test("passes through in-range integers unchanged", () => {
  assert.equal(clampNumber(300, 300, 50, 2_000), 300);
  assert.equal(clampNumber(0, 300, 0, 5_000), 0);
  assert.equal(clampNumber(2_000, 300, 50, 2_000), 2_000);
});

test("returns the fallback verbatim even when it falls outside the range", () => {
  assert.equal(clampNumber("nope", 9_999, 50, 2_000), 9_999);
  assert.equal(clampNumber(undefined, -1, 50, 2_000), -1);
});
