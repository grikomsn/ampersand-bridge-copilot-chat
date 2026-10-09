import assert from "node:assert/strict";
import test from "node:test";
import { credentialReference } from "./auth";

test("credential fingerprints are stable and non-reversible", () => {
  assert.equal(credentialReference(" synthetic "), credentialReference("synthetic"));
  assert.match(credentialReference("synthetic"), /^[a-f0-9]{16}$/);
  assert.notEqual(credentialReference("synthetic"), credentialReference("other"));
});
