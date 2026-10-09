import assert from "node:assert/strict";
import test from "node:test";
import {
  advertisedModelLimits,
  FALLBACK_MODELS,
  modelCatalogFromApi,
  formatModelName,
  formatTokenLimit,
  getModelMetadata,
  isAmpersandChatModel,
  orderModelMetadata,
  orderModels,
  resolveMaxOutputTokens,
} from "./catalog";

test("accepts Ampersand Bridge chat model IDs and excludes non-chat families", () => {
  assert.equal(isAmpersandChatModel("deepseek-ai/deepseek-v4-pro"), true);
  assert.equal(isAmpersandChatModel("moonshotai/kimi-k2.7-code"), true);
  assert.equal(isAmpersandChatModel("multilingual-e5-large-instruct"), true);
  assert.equal(isAmpersandChatModel("text-embedding-3-large"), false);
  assert.equal(isAmpersandChatModel("image/generator"), false);
});

test("orders documented fallback models before other discovered models", () => {
  assert.deepEqual(
    orderModels(["future-chat", "zai-org/glm-5.2", "OPENAI/GPT-OSS-120B", "openai/gpt-oss-120b"]),
    [
      "openai/gpt-oss-120b",
      "zai-org/glm-5.2",
      "future-chat",
    ],
  );
});

test("formats model IDs for the VS Code picker", () => {
  assert.equal(formatModelName("deepseek-ai/deepseek-v4-pro"), "DeepSeek V4 Pro");
  assert.equal(formatModelName("zai-org/glm-5.2"), "GLM 5.2");
  assert.equal(formatModelName("openai/gpt-oss-120b"), "GPT OSS 120B");
  assert.equal(formatModelName("qwen/qwen3.8-27b"), "Qwen 3.8 27B");
  assert.equal(formatModelName("zai-org/glm-5.4"), "GLM 5.4");
  assert.equal(formatModelName("deepseek-ai/deepseek-v5"), "DeepSeek V5");
  assert.equal(formatModelName("qwen/qwen3.9-27b"), "Qwen3.9 27B");
  assert.equal(formatModelName("future-vendor/future-model"), "Future Model");
});

test("provides documented fallback limits", () => {
  for (const id of [
    "deepseek-ai/deepseek-v4-flash",
    "deepseek-ai/deepseek-v4-pro",
    "moonshotai/kimi-k3",
    "zai-org/glm-5.3",
    "zai-org/glm-5.2",
  ]) {
    assert.equal(getModelMetadata(id).contextLength, 1_048_576);
  }
  assert.equal(getModelMetadata("moonshotai/kimi-k3").imageInput, true);
  assert.equal(getModelMetadata("deepseek-ai/deepseek-v4.1-flash").imageInput, true);
  assert.equal(getModelMetadata("deepseek-ai/deepseek-v4.1-flash").maxOutputTokens, 384_000);
  assert.equal(getModelMetadata("zai-org/glm-5.3-flash").contextLength, 1_048_550);
  assert.equal(getModelMetadata("zai-org/glm-5.3-flash").defaultReasoningEffort, "max");
  assert.equal(getModelMetadata("qwen/qwen3.6-27b").maxOutputTokens, 65_536);
  assert.deepEqual(getModelMetadata("zai-org/glm-5.2"), {
    id: "zai-org/glm-5.2",
    name: "GLM 5.2",
    version: "unknown",
    contextLength: 1_048_576,
    maxOutputTokens: 131_072,
    imageInput: false,
    toolCalling: true,
    reasoningEfforts: ["none", "high", "max"],
    defaultReasoningEffort: "max",
    cost: { input: 1, cacheRead: 0.3, output: 4 },
  });
  assert.deepEqual(getModelMetadata("google/gemma-4-31b-it"), {
    id: "google/gemma-4-31b-it",
    name: "Gemma 4 31B IT",
    version: "unknown",
    contextLength: 262_144,
    maxOutputTokens: 32_768,
    imageInput: true,
    toolCalling: true,
    reasoningEfforts: ["none", "high"],
    defaultReasoningEffort: "none",
    cost: { input: 0.2, cacheRead: 0.05, output: 0.5 },
  });
  assert.equal(formatTokenLimit(1_000_000), "1M");
  assert.equal(formatTokenLimit(262_144), "256K");
});

test("uses exactly the discovered catalog and advertised metadata", () => {
  assert.deepEqual(
    orderModelMetadata([
      {
        id: "custom-vision",
        name: "Ampersand Bridge: Custom Vision",
        context_length: 500_000,
        max_completion_tokens: 64_000,
        input_modalities: ["text", "image"],
      },
      { id: "CUSTOM-VISION", context_length: 1_000_000 },
      { id: "text-embedding-3-large", context_length: 1_000_000 },
    ]),
    [
      {
        id: "custom-vision",
        name: "Custom Vision",
        version: "unknown",
        contextLength: 500_000,
        maxOutputTokens: 64_000,
        imageInput: true,
        toolCalling: true,
        cost: undefined,
      },
    ],
  );
});

test("reads live reasoning_efforts and reasoning_effort_default verbatim", () => {
  const [live] = orderModelMetadata([
    {
      id: "zai-org/glm-5.2",
      tool_calling: false,
      reasoning_efforts: ["none", "high", "max"],
      reasoning_effort_default: "max",
      created: 1_700_000_000,
    },
  ]);
  assert.equal(live.toolCalling, false);
  assert.deepEqual(live.reasoningEfforts, ["none", "high", "max"]);
  assert.equal(live.defaultReasoningEffort, "max");
  assert.equal(live.releaseDate, "2023-11-14");
});

test("falls back to per-model reasoning efforts when the live catalog omits them", () => {
  assert.deepEqual(getModelMetadata("google/gemma-4-31b-it").reasoningEfforts, ["none", "high"]);
  assert.deepEqual(getModelMetadata("moonshotai/kimi-k2.7-code").reasoningEfforts, ["high"]);
  assert.equal(getModelMetadata("moonshotai/kimi-k2.7-code").defaultReasoningEffort, "high");
  assert.equal(getModelMetadata("some-unknown-model").reasoningEfforts, undefined);
});

test("ignores a live default the model does not list and keeps the model default", () => {
  const [live] = orderModelMetadata([
    {
      id: "qwen/qwen3.8-27b",
      capabilities: ["reasoning"],
      reasoning_efforts: ["none", "low", "medium", "xhigh"],
      reasoning_effort_default: "high", // not in the list → keep model default
    },
  ]);
  assert.deepEqual(live.reasoningEfforts, ["none", "low", "medium", "xhigh"]);
  assert.equal(live.defaultReasoningEffort, "xhigh");
});

test("reads Ampersand Bridge capabilities arrays and per-million pricing", () => {
  const [live] = orderModelMetadata([
    {
      id: "google/gemma-4-31b-it",
      context_window: 262_144,
      capabilities: ["reasoning", "tool_calling", "vision"],
      input_per_1m: "0.20",
      cached_input_per_1m: "0.05",
      output_per_1m: "0.50",
    },
  ]);
  assert.equal(live.imageInput, true);
  assert.equal(live.toolCalling, true);
  // capabilities advertise reasoning but no explicit list → fallback efforts apply.
  assert.deepEqual(live.reasoningEfforts, ["none", "high"]);
  assert.deepEqual(live.cost, { input: 0.2, cacheRead: 0.05, output: 0.5 });
});

test("keeps verified fallback capabilities ahead of secondary metadata", () => {
  const [enriched] = orderModelMetadata([{ id: "deepseek-ai/deepseek-v4-pro" }], {
    "deepseek-ai/deepseek-v4-pro": {
      id: "deepseek-ai/deepseek-v4-pro",
      description: "General coding model",
      imageInput: true,
      toolCalling: false,
      maxOutputTokens: 1,
      releaseDate: "2025-12-01",
    },
  });
  assert.equal(enriched.description, "General coding model");
  assert.equal(enriched.imageInput, false);
  assert.equal(enriched.toolCalling, true);
  assert.equal(enriched.maxOutputTokens, 384_000);
  assert.equal(enriched.releaseDate, "2025-12-01");
});

test("prefers live model pricing and falls back to Ampersand Bridge's official table", () => {
  const [live] = orderModelMetadata([
    {
      id: "google/gemma-4-31b-it",
      pricing: {
        prompt: "1",
        cache_prompt: "0.2",
        completion: "2",
      },
    },
  ]);
  assert.deepEqual(live.cost, { input: 1, cacheRead: 0.2, output: 2 });

  const [fallback] = orderModelMetadata([{ id: "zai-org/glm-5.2" }]);
  assert.deepEqual(fallback.cost, {
    input: 1,
    cacheRead: 0.3,
    output: 4,
  });
});

test("uses the official display name when Ampersand Bridge reuses a colliding raw name", () => {
  const [live] = orderModelMetadata([
    {
      id: "openai/gpt-oss-120b",
      name: "OpenAI: GPT OSS 120B",
      context_window: 131_072,
      max_completion_tokens: 131_072,
      capabilities: ["reasoning", "tool_calling"],
    },
  ]);
  assert.equal(live.id, "openai/gpt-oss-120b");
  assert.equal(live.name, "GPT OSS 120B");
  assert.deepEqual(live.reasoningEfforts, ["low", "medium", "high"]);
  assert.equal(live.defaultReasoningEffort, "medium");
  assert.equal(live.imageInput, false);
});

test("models.dev enrichment never widens an authoritative live effort list", () => {
  const [enriched] = orderModelMetadata([
    { id: "openai/gpt-oss-120b", reasoning_efforts: ["low", "medium", "high"], reasoning_effort_default: "medium" },
  ], {
    "openai/gpt-oss-120b": { id: "openai/gpt-oss-120b", reasoningOptions: ["low", "medium", "high", "xhigh"] },
  });
  assert.deepEqual(enriched.reasoningEfforts, ["low", "medium", "high"]);
  assert.equal(enriched.defaultReasoningEffort, "medium");
});

test("preserves a successful empty catalog without manufacturing fallback models", () => {
  assert.deepEqual(orderModelMetadata([]), []);
  assert.deepEqual(modelCatalogFromApi({ data: [] }), []);
  assert.deepEqual(orderModelMetadata([null, [], "bad", { id: "text-embedding-3" }]), []);
  for (const payload of [null, {}, { data: null }, { data: {} }]) {
    assert.throws(() => modelCatalogFromApi(payload), /invalid model catalog/);
  }
});

test("uses models.dev limits for unknown models before generic defaults", () => {
  const [model] = orderModelMetadata([{ id: "new-vendor/new-model" }], {
    "new-vendor/new-model": {
      id: "new-vendor/new-model", contextLength: 1_000_000, maxOutputTokens: 384_000,
      imageInput: true, toolCalling: false, reasoningOptions: ["low", "high"],
    },
  });
  assert.equal(model.contextLength, 1_000_000);
  assert.equal(model.maxOutputTokens, 384_000);
  assert.equal(model.imageInput, true);
  assert.equal(model.toolCalling, false);
  assert.deepEqual(model.reasoningEfforts, ["low", "high"]);
  assert.equal(model.defaultReasoningEffort, "high");
});

test("explicit live limits and capability exclusions survive enrichment", () => {
  const secondary = { id: "future-model", contextLength: 1_000_000, maxOutputTokens: 384_000,
    imageInput: true, toolCalling: true, reasoningOptions: ["high"] };
  const [model] = orderModelMetadata([
    { id: "future-model", context_window: 20_000, max_output_tokens: 1000,
      capabilities: [], reasoning_efforts: [] },
  ], { "future-model": secondary });
  assert.equal(model.contextLength, 20_000);
  assert.equal(model.maxOutputTokens, 1000);
  assert.equal(model.imageInput, false);
  assert.equal(model.toolCalling, false);
  assert.equal(model.reasoningEfforts, undefined);
  const [flags] = orderModelMetadata([
    { id: "future-model", input_modalities: ["text"], tool_calling: false, reasoning_effort: false },
  ], { "future-model": secondary });
  assert.equal(flags.imageInput, false);
  assert.equal(flags.toolCalling, false);
  assert.equal(flags.reasoningEfforts, undefined);
});

test("a live capability list can disable verified fallback reasoning and images", () => {
  const [model] = orderModelMetadata([{ id: "moonshotai/kimi-k3", capabilities: ["chat"] }]);
  assert.equal(model.imageInput, false);
  assert.equal(model.toolCalling, false);
  assert.equal(model.reasoningEfforts, undefined);
});

test("accepts valid limit aliases when earlier fields are malformed", () => {
  const [model] = orderModelMetadata([
    { id: "future-model", context_window: "invalid", context_length: 40_000,
      max_completion_tokens: 0, max_output_tokens: 2000, created: 1e20 },
  ]);
  assert.equal(model.contextLength, 40_000);
  assert.equal(model.maxOutputTokens, 2000);
  assert.equal(model.releaseDate, undefined);
});

test("fallback reasoning defaults always belong to a narrowed live list", () => {
  const [model] = orderModelMetadata([{ id: "zai-org/glm-5.2", reasoning_efforts: ["low", "high"] }]);
  assert.deepEqual(model.reasoningEfforts, ["low", "high"]);
  assert.equal(model.defaultReasoningEffort, "high");
});

test("uses the selected catalog limit for default and explicit output settings", () => {
  assert.equal(resolveMaxOutputTokens(0, 65_536), 65_536);
  assert.equal(resolveMaxOutputTokens(100_000, 65_536), 65_536);
  assert.equal(resolveMaxOutputTokens(32_000, 65_536), 32_000);
});

test("reserves a usable input budget even when output capability fills the window", () => {
  for (const contextLength of [229_376, 262_144, 450_000, 1_048_576]) {
    const limits = advertisedModelLimits({ contextLength, maxOutputTokens: contextLength });
    assert.equal(limits.maxInputTokens, contextLength - 32_768);
    assert.equal(limits.maxOutputTokens, 32_768);
    const configured = advertisedModelLimits({ contextLength, maxOutputTokens: 131_072 }, 16_384);
    assert.equal(configured.maxInputTokens + configured.maxOutputTokens, contextLength);
    assert.equal(configured.maxOutputTokens, 16_384);
  }
});

test("every supported fallback has room for conversation and a bounded response", () => {
  for (const id of FALLBACK_MODELS) {
    const metadata = getModelMetadata(id);
    const limits = advertisedModelLimits(metadata);
    assert.ok(limits.maxInputTokens > 32_768, id);
    assert.ok(limits.maxOutputTokens > 0 && limits.maxOutputTokens <= 32_768, id);
    assert.equal(limits.maxInputTokens + limits.maxOutputTokens, metadata.contextLength, id);
  }
});
