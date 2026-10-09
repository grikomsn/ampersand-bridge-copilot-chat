import assert from "node:assert/strict";
import test from "node:test";
import { apiKeyFromConfiguration, entryIdFromConfiguration, NativeEntries, qualifiedModelId } from "./provider-profile";

test("requires an explicit canonical entry ID rather than a display-name slug", () => {
  for (const entryId of [undefined, "A B", "A-B", "first::second", "x".repeat(65)]) {
    assert.throws(() => entryIdFromConfiguration({ entryId, name: "display label" }), /unique entryId/);
  }
  assert.equal(entryIdFromConfiguration({ entryId: "work-team" }), "work-team");
  assert.equal(apiKeyFromConfiguration({ apiKey: "  synthetic-key  " }), "synthetic-key");
  assert.equal(apiKeyFromConfiguration({ apiKey: "   " }), undefined);
  assert.equal(apiKeyFromConfiguration({}), undefined);
});

test("rotation preserves selections and retires old handles, including rotating back", () => {
  const entries = new NativeEntries();
  const a = entries.register({ entryId: "work", apiKey: "synthetic-a" });
  assert.equal(entries.register({ entryId: "work", apiKey: "synthetic-a" }).generation, a.generation);
  const b = entries.register({ entryId: "work", apiKey: "synthetic-b" });
  assert.throws(() => entries.key(a), /changed or was forgotten/);
  assert.equal(qualifiedModelId(a.entryId, "deepseek-ai/deepseek-v4-flash"), qualifiedModelId(b.entryId, "deepseek-ai/deepseek-v4-flash"));
  const a2 = entries.register({ entryId: "work", apiKey: "synthetic-a" });
  assert.notEqual(a.generation, a2.generation);
  assert.equal(entries.matches(a), false);
  assert.equal(entries.key(a2), "synthetic-a");
});

test("entries with the same key and label keep separate scope and explicit forget retires handles", () => {
  const entries = new NativeEntries();
  const a = entries.register({ entryId: "one", name: "Same", apiKey: "synthetic-shared" });
  const b = entries.register({ entryId: "two", name: "Same", apiKey: "synthetic-shared" });
  assert.notEqual(a.credentialRef, b.credentialRef);
  entries.forget("one");
  assert.throws(() => entries.key(a), /changed or was forgotten/);
  assert.equal(entries.key(b), "synthetic-shared");
  assert.throws(() => entries.get("one"), /Select an available/);
  assert.equal(entries.isForgotten("one"), true);
  entries.restore("one");
  assert.equal(entries.isForgotten("one"), false);
});

test("forgotten entry IDs are validated on restore and forget", () => {
  const entries = new NativeEntries();
  assert.throws(() => entries.restore("BAD ID"), /unique entryId/);
  assert.throws(() => entries.forget("BAD ID"), /unique entryId/);
});
