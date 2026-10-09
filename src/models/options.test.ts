import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReasoningEffort,
  buildModelConfigurationSchema,
  contextSizeOptions,
  modelEffortSpec,
  resolveContextCap,
  resolveContextSize,
  resolveReasoningEffort,
  type ModelEffortSpec,
} from "./options";

const STANDARD: ModelEffortSpec = { efforts: ["low", "medium", "high"], defaultEffort: "medium" };
const TOGGLE: ModelEffortSpec = { efforts: ["none", "high"], defaultEffort: "high" };
const WITH_MAX: ModelEffortSpec = { efforts: ["none", "high", "max"], defaultEffort: "max" };

test("builds an effort spec from a model's supported list and default", () => {
  assert.deepEqual(modelEffortSpec(["low", "high"], "high"), { efforts: ["low", "high"], defaultEffort: "high" });
  assert.deepEqual(modelEffortSpec(["none", "high", "max"], "max"), WITH_MAX);
  assert.equal(modelEffortSpec([], undefined), undefined);
  assert.equal(modelEffortSpec(undefined, undefined), undefined);
});

test("effort spec ignores unsupported values and falls back to the last listed effort", () => {
  assert.deepEqual(modelEffortSpec(["low", "bogus" as never, "high"], undefined), {
    efforts: ["low", "high"],
    defaultEffort: "high",
  });
});

test("exposes the model's own reasoning efforts in the model picker", () => {
  const schema = buildModelConfigurationSchema(STANDARD);
  assert.deepEqual(schema?.properties.reasoningEffort.enum, ["low", "medium", "high"]);
  assert.deepEqual(schema?.properties.reasoningEffort.enumItemLabels, ["Low", "Medium", "High"]);
  assert.equal(schema?.properties.reasoningEffort.default, "medium");
  assert.equal(schema?.properties.reasoningEffort.group, "navigation");
});

test("labels and describes max and xhigh efforts", () => {
  const schema = buildModelConfigurationSchema({
    efforts: ["none", "low", "medium", "xhigh", "max"],
    defaultEffort: "medium",
  });
  assert.deepEqual(schema?.properties.reasoningEffort.enumItemLabels, [
    "None",
    "Low",
    "Medium",
    "Extra High",
    "Max",
  ]);
});

test("per-request effort overrides the workspace default within the model's list", () => {
  assert.equal(resolveReasoningEffort(STANDARD, { reasoningEffort: "low" }, "high"), "low");
  assert.equal(resolveReasoningEffort(STANDARD, { thinkingEffort: "medium" }, "high"), "medium");
  assert.equal(resolveReasoningEffort(TOGGLE, undefined, "high"), "high");
});

test("an effort the model does not support falls back to the model's own default", () => {
  // qwen3.8 supports none/low/medium/xhigh but not high → resolves to its own default.
  const qwen = modelEffortSpec(["none", "low", "medium", "xhigh"], "medium")!;
  assert.equal(resolveReasoningEffort(qwen, { reasoningEffort: "high" }, "high"), "medium");
  // deepseek-flash has no medium → falls back to its own default ("none").
  const flash = modelEffortSpec(["none", "high", "max"], "none")!;
  assert.equal(resolveReasoningEffort(flash, undefined, "medium"), "none");
  assert.equal(resolveReasoningEffort(flash, { reasoningEffort: "max" }, "medium"), "max");
});

test("models without reasoning control resolve no effort and omit the parameter", () => {
  assert.equal(resolveReasoningEffort(undefined, { reasoningEffort: "high" }, "high"), undefined);
  assert.deepEqual(applyReasoningEffort({ model: "m" }, undefined), { model: "m" });
});

test("sends Ampersand Bridge's documented reasoning_effort parameter", () => {
  assert.deepEqual(applyReasoningEffort({ model: "glm-5.2" }, "none"), {
    model: "glm-5.2",
    reasoning_effort: "none",
  });
  assert.deepEqual(applyReasoningEffort({ model: "glm-5.2" }, "max"), {
    model: "glm-5.2",
    reasoning_effort: "max",
  });
});

test("offers context tiers below the registered input limit", () => {
  assert.deepEqual(contextSizeOptions(1_048_576)?.map((option) => option.value), ["auto", 65_536, 131_072, 200_000, 1_048_576]);
  assert.deepEqual(contextSizeOptions(1_048_576)?.map((option) => option.label), ["Auto", "64K", "128K", "200K", "Maximum"]);
  assert.equal(contextSizeOptions(65_536), undefined);
  assert.equal(contextSizeOptions(32_000), undefined);
});

test("resolves the effective context cap from the selected tier", () => {
  assert.equal(resolveContextCap(131_072, 1_048_576), 131_072);
  assert.equal(resolveContextCap(1_500_000, 1_048_576), undefined);
  assert.equal(resolveContextCap(0, 1_048_576), undefined);
  assert.equal(resolveContextCap(65_536, 65_536), undefined);
});

test("reads the context size from picker configuration", () => {
  assert.equal(resolveContextSize({ contextSize: 131_072 }), 131_072);
  assert.equal(resolveContextSize({ contextSize: 0 }), 0);
  assert.equal(resolveContextSize({ contextSize: "131072" }), 0);
  assert.equal(resolveContextSize(undefined), 0);
});

test("exposes the Context Window control with and without reasoning controls", () => {
  const combined = buildModelConfigurationSchema(STANDARD, contextSizeOptions(1_048_576));
  assert.deepEqual(combined?.properties.reasoningEffort.enum, ["low", "medium", "high"]);
  assert.deepEqual(combined?.properties.contextSize.enum, ["auto", 65_536, 131_072, 200_000, 1_048_576]);
  assert.equal(combined?.properties.contextSize.default, "auto");
  assert.equal(combined?.properties.contextSize.group, "tokens");
  assert.equal(Object.entries(combined!.properties!).find(([, property]) => property.group === "tokens")?.[0], "contextSize");

  const contextOnly = buildModelConfigurationSchema(undefined, contextSizeOptions(1_048_576));
  assert.equal("reasoningEffort" in (contextOnly?.properties ?? {}), false);
  assert.deepEqual(contextOnly?.properties.contextSize.enum, ["auto", 65_536, 131_072, 200_000, 1_048_576]);
  assert.equal(buildModelConfigurationSchema(undefined, undefined), undefined);
});

// Mirrors VS Code's context indicator contract: numeric selections replace input,
// while a nonnumeric Auto selection falls back to the registered input limit.
test("Auto preserves the full context window in the VS Code indicator", () => {
  for (const input of [78_000, 244_800, 983_040]) {
    const options = contextSizeOptions(input)!;
    const auto = options.find((option) => option.label === "Auto")!;
    const output = 16_384;
    const displayedInput = typeof auto.value === "number" ? auto.value : input;
    assert.equal(displayedInput + output, input + output);
    assert.ok(options.every((option) => typeof option.value !== "number" || option.value > 0));
  }
});
