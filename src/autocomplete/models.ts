/**
 * Inline-completion model candidates, ordered fastest first.
 *
 * Badges carry measured inline-completion latency against api.aiand.com
 * (median time-to-first-byte over a realistic fill-in-the-middle prompt with
 * each model's reasoning-off effort, 15 interleaved runs, 2026-10-21). The
 * QuickPick command renders this list and writes the selected id to
 * `ampersandBridge.inlineSuggestionsModel`, so choices need no reload. Unknown
 * model ids stay reachable through the command's custom entry and the raw
 * setting.
 *
 * Models whose support ends on 2026-10-27 (`deepseek-ai/deepseek-v4-flash`,
 * `moonshotai/kimi-k2.7-code`, `zai-org/glm-5.2`) are not offered; their
 * replacements are listed instead.
 *
 * Pure and unit-tested.
 */

export interface InlineModelCandidate {
  readonly id: string;
  /** Short measured/compatibility badge, e.g. "★ recommended · measured 1.3s TTFB". */
  readonly badge: string;
  /** One-line rationale shown under the model id. */
  readonly detail: string;
}

export const INLINE_MODEL_CANDIDATES: readonly InlineModelCandidate[] = [
  {
    id: "deepseek-ai/deepseek-v4.1-flash",
    badge: "★ default · measured ~0.8s TTFB",
    detail: "Replacement for DeepSeek V4 Flash; economical reasoning and long-context work.",
  },
  {
    id: "google/gemma-4-31b-it",
    badge: "fastest TTFB · measured ~0.4s",
    detail: "Fastest measured first token; image-capable instruct model.",
  },
  {
    id: "zai-org/glm-5.3",
    badge: "measured ~0.6s TTFB",
    detail: "GLM model; reasoning runs at its lightest supported effort.",
  },
  {
    id: "qwen/qwen3.6-27b",
    badge: "measured ~0.6s TTFB",
    detail: "Fast first token with a compact Qwen model.",
  },
  {
    id: "motif-technologies/motif-3",
    badge: "measured ~0.6s TTFB",
    detail: "Motif chat model; slower first token than the flash tiers.",
  },
  {
    id: "zai-org/glm-5.3-flash",
    badge: "measured ~0.7s TTFB",
    detail: "Replacement for GLM 5.2; multimodal with a million-token context.",
  },
  {
    id: "openai/gpt-oss-120b",
    badge: "measured ~0.7s TTFB · low cost",
    detail: "Cheapest per-token Ampersand Bridge model; reasoning runs at its lightest supported effort.",
  },
  {
    id: "moonshotai/kimi-k3",
    badge: "measured ~0.9s TTFB · larger",
    detail: "Replacement for Kimi K2.7 Code; prefer smaller tiers for inline latency.",
  },
  {
    id: "qwen/qwen3.8-27b",
    badge: "measured ~0.9s TTFB",
    detail: "Fast first token with a compact Qwen model.",
  },
  {
    id: "deepseek-ai/deepseek-v4-pro",
    badge: "measured ~0.9s TTFB · larger",
    detail: "Larger DeepSeek model; prefer the flash tier for inline latency.",
  },
];

export interface InlineModelChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly detail: string;
}

/** Build QuickPick-shaped choices, pinning an unlisted current id to the top. */
export function inlineModelChoices(currentId: string): InlineModelChoice[] {
  const listed = INLINE_MODEL_CANDIDATES.map((candidate) => ({
    id: candidate.id,
    label: candidate.id === currentId ? `$(check) ${candidate.id}` : candidate.id,
    description: candidate.badge,
    detail: candidate.detail,
  }));
  const pinned = !INLINE_MODEL_CANDIDATES.some((candidate) => candidate.id === currentId)
    ? [{
      id: currentId,
      label: `$(check) ${currentId}`,
      description: "current value",
      detail: "Kept from your settings; not in the vetted list.",
    }]
    : [];
  return [...pinned, ...listed];
}
