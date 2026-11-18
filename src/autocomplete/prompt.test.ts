import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletionPrompt, COMPLETION_SYSTEM_PROMPT } from "./prompt";

test("emulates fill-in-the-middle with FIM tokens", () => {
  const prompt = buildCompletionPrompt("before", "after");
  assert.equal(prompt.messages[0]?.content, COMPLETION_SYSTEM_PROMPT);
  assert.equal(
    prompt.messages[1]?.content,
    "<|fim_prefix|>before<|fim_suffix|>after<|fim_middle|>",
  );
});

test("picks a reasoning-off effort the model accepts", () => {
  assert.deepEqual(buildCompletionPrompt("a", "b", ["none", "high"]).extra, { reasoning_effort: "none" });
  assert.deepEqual(buildCompletionPrompt("a", "b", ["low", "high"]).extra, { reasoning_effort: "low" });
  assert.deepEqual(buildCompletionPrompt("a", "b", undefined).extra, {});
});

