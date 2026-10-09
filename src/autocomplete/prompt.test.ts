import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletionPrompt, COMPLETION_SYSTEM_PROMPT, completionReasoningEffort, stripSpecialTokens } from "./prompt";

test("emulates fill-in-the-middle with FIM tokens", () => {
  const prompt = buildCompletionPrompt("before", "after");
  assert.equal(prompt.messages[0]?.content, COMPLETION_SYSTEM_PROMPT);
  assert.equal(
    prompt.messages[1]?.content,
    "<|fim_prefix|>before<|fim_suffix|>after<|fim_middle|>",
  );
});

test("picks a reasoning-off effort the model accepts", () => {
  assert.equal(completionReasoningEffort(["none", "high", "max"]), "none");
  assert.equal(completionReasoningEffort(["low", "high"]), "low");
  assert.equal(completionReasoningEffort(undefined), undefined);
  assert.equal(completionReasoningEffort([]), undefined);
  assert.deepEqual(buildCompletionPrompt("a", "b", ["none", "high"]).extra, { reasoning_effort: "none" });
  assert.deepEqual(buildCompletionPrompt("a", "b", ["low", "high"]).extra, { reasoning_effort: "low" });
  assert.deepEqual(buildCompletionPrompt("a", "b", undefined).extra, {});
});

test("strips echoed special tokens from suggestions", () => {
  assert.equal(stripSpecialTokens("<|file_separator|>    out.append(x)"), "    out.append(x)");
  assert.equal(stripSpecialTokens("    out.append(x)<|fim_middle|>"), "    out.append(x)");
  assert.equal(stripSpecialTokens("<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>c"), "abc");
  assert.equal(stripSpecialTokens("    out.append(x)"), "    out.append(x)");
  assert.equal(stripSpecialTokens("echo <| b; # no closing pair"), "echo <| b; # no closing pair");
  assert.equal(stripSpecialTokens("<|file_separator|>"), "");
});
