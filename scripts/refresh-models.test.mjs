import assert from "node:assert/strict";
import test from "node:test";
import { compareCatalogs, fetchCatalog, formatReport } from "./refresh-models.mjs";

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
