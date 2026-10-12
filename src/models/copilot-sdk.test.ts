import assert from "node:assert/strict";
import test from "node:test";
import { applyReasoningEffort, buildModelConfigurationSchema, contextSizeOptions, modelEffortSpec, resolveReasoningEffort } from "./options";

// VS Code 1.141 reads reasoningEffort, then filters through its agent-host tiers.
const SDK_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

test("Copilot SDK BYOK discovers exactly the ai& model's authoritative effort list", () => {
  const cases = [
    [["low", "medium", "high"], "medium"],
    [["none", "high", "max"], "max"],
    [["none", "low", "medium", "xhigh"], "xhigh"],
  ] as const;
  for (const [supported, defaultEffort] of cases) {
    const spec = modelEffortSpec(supported, defaultEffort);
    assert.ok(spec);
    for (const context of [undefined, contextSizeOptions(1_048_576)]) {
      const schema = buildModelConfigurationSchema(spec, context);
      const effortSchema = schema?.properties.reasoningEffort;
      assert.ok(effortSchema, "BYOK requires reasoningEffort");
      const bridged = (effortSchema.enum as unknown[]).filter((value): value is string => typeof value === "string");
      assert.deepEqual(bridged.filter((effort) => SDK_EFFORTS.has(effort)), supported);
      assert.equal(effortSchema.default, defaultEffort);
      for (const selected of bridged.filter((effort) => SDK_EFFORTS.has(effort))) {
        const effort = resolveReasoningEffort(spec, { reasoningEffort: selected }, "high");
        assert.equal(effort, selected);
        assert.deepEqual(applyReasoningEffort({}, effort), { reasoning_effort: selected });
      }
    }
  }
  const contextOnly = buildModelConfigurationSchema(undefined, contextSizeOptions(1_048_576));
  assert.equal(contextOnly?.properties.reasoningEffort, undefined);
  assert.deepEqual(applyReasoningEffort({}, resolveReasoningEffort(undefined, { reasoningEffort: "high" }, "high")), {});
});
