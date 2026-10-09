import assert from "node:assert/strict";
import test from "node:test";
import { costCategory, ampersandModelCost, modelCostFromApi, modelPricingFields } from "./pricing";

test("passes through Ampersand Bridge per-million API rates without per-token scaling", () => {
  assert.deepEqual(modelCostFromApi({
    prompt: "0.35",
    cache_prompt: "0.01",
    completion: "0.80",
  }), { input: 0.35, cacheRead: 0.01, output: 0.8 });
  assert.deepEqual(modelCostFromApi({
    prompt: "0.08",
    cache_prompt: "0.007",
    completion: "0.20",
  }), { input: 0.08, cacheRead: 0.007, output: 0.2 });
  assert.equal(modelCostFromApi({ prompt: "invalid", completion: "0.000001" }), undefined);
});

test("converts USD per-million rates to VS Code pricing fields", () => {
  assert.deepEqual(modelPricingFields({ input: 0.18, cacheRead: 0.04, output: 0.35 }), {
    pricing: "In: $0.18 · Cached: $0.04 · Out: $0.35 /1M tokens",
    inputCost: 18,
    outputCost: 35,
    cacheCost: 4,
    priceCategory: "low",
  });
  assert.equal(modelPricingFields(undefined), undefined);
});

test("uses current official rates when live metadata omits pricing", () => {
  assert.deepEqual(ampersandModelCost("openai/gpt-oss-120b"), { input: 0.15, cacheRead: 0.08, output: 0.6 });
  assert.deepEqual(ampersandModelCost("deepseek-ai/deepseek-v4.1-flash"), { input: 0.3, cacheRead: 0.02, output: 0.6 });
  assert.deepEqual(ampersandModelCost("zai-org/glm-5.3-flash"), { input: 0.15, cacheRead: 0.03, output: 0.5 });
  assert.deepEqual(ampersandModelCost("google/gemma-4-31b-it"), { input: 0.2, cacheRead: 0.05, output: 0.5 });
  assert.deepEqual(ampersandModelCost("deepseek-ai/deepseek-v4-pro", { input: 1, output: 2 }), { input: 1, output: 2 });
  assert.equal(ampersandModelCost("future-model"), undefined);
});

test("categorizes a weighted three-to-one input and output blend", () => {
  assert.equal(costCategory({ input: 0.2, output: 1.2 }), "low");
  assert.equal(costCategory({ input: 2, output: 12 }), "medium");
  assert.equal(costCategory({ input: 5, output: 25 }), "high");
  assert.equal(costCategory({ input: 30, output: 180 }), "very_high");
});
