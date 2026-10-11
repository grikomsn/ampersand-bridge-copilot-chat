import assert from "node:assert/strict";
import test from "node:test";
import { apiKeyFromConfiguration, Credentials } from "./provider-profile";
import { credentialReference } from "./auth/auth";

test("extracts a trimmed API key from entry configuration", () => {
  assert.equal(apiKeyFromConfiguration({ apiKey: "  synthetic-key  " }), "synthetic-key");
  assert.equal(apiKeyFromConfiguration({ apiKey: "   " }), undefined);
  assert.equal(apiKeyFromConfiguration({}), undefined);
});

test("credentials register once per distinct key and share fingerprints", () => {
  const credentials = new Credentials();
  const first = credentials.register("synthetic-a");
  const second = credentials.register("synthetic-b");
  const shared = credentials.register(" shared ");
  const sameShared = credentials.register("shared");
  assert.notEqual(first, second);
  assert.equal(shared, sameShared);
  assert.equal(credentials.keyForCredential(shared), "shared");
  assert.match(shared, /^[a-f0-9]{16}$/);
  assert.match(credentialReference("key"), /^[a-f0-9]{16}$/);
});

test("has and keyForCredential resolve only provisioned keys", () => {
  const credentials = new Credentials();
  const ref = credentials.register("synthetic-a");
  assert.equal(credentials.has(ref), true);
  assert.equal(credentials.has("deadbeef"), false);
  assert.equal(credentials.keyForCredential("deadbeef"), undefined);
});

test("activeApiKey prefers the most recently provisioned key", async () => {
  const credentials = new Credentials();
  assert.equal(credentials.activeApiKey(), undefined);
  credentials.register("synthetic-a");
  await new Promise((resolve) => setTimeout(resolve, 5));
  credentials.register("synthetic-b");
  assert.equal(credentials.activeApiKey(), "synthetic-b");
});
