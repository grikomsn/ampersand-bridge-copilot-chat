import assert from "node:assert/strict";
import test from "node:test";
import { modelFamily } from "./family";

test("groups namespaced models by their native family", () => {
  assert.equal(modelFamily("deepseek-ai/deepseek-v4-flash"), "deepseek");
  assert.equal(modelFamily("moonshotai/kimi-k3"), "moonshotai");
  assert.equal(modelFamily("zai-org/glm-5.3-flash"), "zai");
  assert.equal(modelFamily("openai/gpt-oss-120b"), "openai");
});
