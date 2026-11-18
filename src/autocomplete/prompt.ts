/**
 * Prompt construction for the Ampersand Bridge chat-completions completion engine.
 *
 * Ampersand Bridge exposes no FIM endpoint, so fill-in-the-middle is emulated with FIM
 * delimiter tokens inline over the fixed `/chat/completions` endpoint, and
 * reasoning is disabled with the accepted `reasoning_effort: "none"` value.
 * Inline latency has not been benchmarked against Ampersand Bridge yet; the default
 * flash-tier model is chosen for its low cost and latency class, not from
 * live measurements.
 *
 * Pure and unit-tested.
 */

import type { ChatCompletionPrompt } from "../kit/autocomplete/chat-engine";
import { completionReasoningEffort, fimUserContent } from "../kit/autocomplete/postprocess";

export const COMPLETION_SYSTEM_PROMPT = "Return only the missing code at the cursor. No explanations, no markdown.";

export function buildCompletionPrompt(
  prefix: string,
  suffix: string,
  efforts?: readonly string[],
): ChatCompletionPrompt {
  const effort = completionReasoningEffort(efforts);
  return {
    messages: [
      { role: "system", content: COMPLETION_SYSTEM_PROMPT },
      { role: "user", content: fimUserContent(prefix, suffix) },
    ],
    extra: effort ? { reasoning_effort: effort } : {},
  };
}
