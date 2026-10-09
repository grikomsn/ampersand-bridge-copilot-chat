import assert from "node:assert/strict";
import test from "node:test";
import { API_BASE, API_ORIGIN, AMPERSAND_ENDPOINTS, extensionUserAgent, ampersandHeaders } from "./protocol";

test("keeps Ampersand Bridge endpoints and request identity centralized", () => {
  assert.equal(AMPERSAND_ENDPOINTS.models, `${API_BASE}/models`);
  assert.equal(AMPERSAND_ENDPOINTS.chat, `${API_BASE}/chat/completions`);
  assert.equal(AMPERSAND_ENDPOINTS.balance, `${API_ORIGIN}/billing/balance`);
  assert.equal(extensionUserAgent("1.2.3", "1.125.0"), "ampersand-bridge-copilot-chat/1.2.3 VSCode/1.125.0");
  assert.deepEqual(ampersandHeaders("secret", "application/json", "agent"), {
    Authorization: "Bearer secret",
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "agent",
  });
});
