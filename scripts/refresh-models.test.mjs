import assert from "node:assert/strict";
import test from "node:test";
import { applyCatalog, compareCatalogs, fetchCatalog, formatReport } from "./refresh-models.mjs";

test("reports additions, absent IDs, and changed fields without changing the inputs", () => {
  const bundled = [{ id: "same", maxOutputTokens: 10, cost: { input: 1, output: 2 } }, { id: "old" }];
  const live = [{ id: "same", maxOutputTokens: 20, cost: { output: 2, input: 1 } }, { id: "new" }];
  const before = structuredClone(bundled);
  assert.deepEqual(compareCatalogs(bundled, live), {
    added: ["new"], absent: ["old"],
    changes: [{ id: "same", field: "maxOutputTokens", before: 10, after: 20 }],
  });
  assert.deepEqual(bundled, before);
});

test("writes a complete report after comparison and escapes external Markdown cells", () => {
  const report = formatReport({ added: ["new|model"], absent: [], changes: [
    { id: "new|model", field: "cost", before: undefined, after: { input: 1, output: 2 } },
  ] }, "https://api.aiand.com/v1/models", "2026-10-08");
  assert.match(report, /2026-10-08/);
  assert.match(report, /new\\\|model/);
  assert.match(report, /omitted/);
  assert.match(report, /"input":1/);
});

test("fetches only the fixed public endpoint without credentials or redirects", async () => {
  const payload = { data: [{ id: "fixture", currency: "usd", context_window: 100, max_output_tokens: 10,
    capabilities: ["reasoning"], reasoning_efforts: ["low"], reasoning_effort_default: "low",
    input_per_1m: "0.1", output_per_1m: "0.2" }] };
  assert.deepEqual(await fetchCatalog(async (url, init) => {
    assert.equal(url, "https://api.aiand.com/v1/models");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).has("Authorization"), false);
    return Response.json(payload);
  }), payload);
});

test("rejects failed, incomplete, or non-USD public catalogs without echoing response bodies", async () => {
  await assert.rejects(fetchCatalog(async () => new Response("private error fixture", { status: 500 })),
    /^Error: Public Ampersand Bridge catalog request failed \(HTTP 500\)$/);
  for (const payload of [null, {}, { data: [null] }, { data: [{ id: "fixture" }] },
    { data: [{ id: "fixture", currency: "jpy" }] }]) {
    await assert.rejects(fetchCatalog(async () => Response.json(payload)), /Public Ampersand Bridge/);
  }
});

test("applyCatalog preserves the region declarations it rewrites", () => {
  const catalog = [
    "import type { ReasoningEffort } from \"./options\";",
    "",
    "const FALLBACK_REASONING_EFFORTS: Readonly<Record<string, {",
    "  readonly efforts: readonly ReasoningEffort[];",
    "  readonly defaultEffort: ReasoningEffort;",
    "}>> = {",
    "  \"fixture/model\": { efforts: [\"none\"], defaultEffort: \"none\" },",
    "};",
    "",
    "export const FALLBACK_MODEL_METADATA: readonly AmpersandModelMetadata[] = [",
    "  model(\"fixture/model\", 1_048_576, 32_768),",
    "];"] .join("\n");
  const pricing = [
    "export interface ModelCost { readonly input: number; }",
    "",
    "const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {",
    "  \"fixture/model\": { input: 1, cacheRead: 0.1, output: 2 },",
    "};",
    ""].join("\n");
  const live = [{
    id: "fixture/model", name: "Fixture Model", contextLength: 1_048_576,
    maxOutputTokens: 65_536, imageInput: true, toolCalling: true,
    reasoningEfforts: ["high"], defaultReasoningEffort: "high",
    cost: { input: 2, cacheRead: 0.2, output: 4 },
  }];
  const result = applyCatalog(catalog, pricing, ["fixture/model"], live);
  // Every declaration survives; only the interiors are rewritten.
  assert.match(result.catalog, /const FALLBACK_REASONING_EFFORTS: Readonly<Record<string, \{/);
  assert.match(result.catalog, /export const FALLBACK_MODEL_METADATA: readonly AmpersandModelMetadata\[\] = \[/);
  assert.match(result.catalog, /\"fixture\/model\": \{ efforts: \[\"high\"\], defaultEffort: \"high\" \},/);
  assert.match(result.catalog, /model\("fixture\/model", 1_048_576, 65536, true\),/);
  assert.match(result.pricing, /const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = \{/);
  assert.match(result.pricing, /\"fixture\/model\": \{ input: 2, cacheRead: 0.2, output: 4 \},/);
});
