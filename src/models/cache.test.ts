import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogSnapshots } from "./cache";

test("restores only complete persisted Ampersand Bridge catalogs", () => {
  const model = {
    id: "m",
    name: "M",
    version: "1",
    contextLength: 10,
    maxOutputTokens: 5,
    imageInput: false,
    toolCalling: true,
    reasoningEfforts: ["none", "high"],
  };
  assert.deepEqual(parseCatalogSnapshots({ legacy: [model], broken: [{ id: "bad" }] }), { legacy: [model] });
  assert.deepEqual(parseCatalogSnapshots(null), {});
  assert.deepEqual(parseCatalogSnapshots({ legacy: [], invalid: [null] }), { legacy: [] });
});
