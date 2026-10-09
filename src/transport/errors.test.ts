import assert from "node:assert/strict";
import test from "node:test";
import { apiError, isRejectedKey } from "./errors";

test("extracts bounded provider errors without echoing response headers", async () => {
  const error = await apiError(
    "Request failed",
    new Response(JSON.stringify({ error: { message: "bad model" } }), {
      status: 400,
      headers: { authorization: "secret" },
    }),
  );
  assert.equal(error.message, "Request failed (HTTP 400): bad model");
  assert.equal(error.message.includes("secret"), false);
});

test("tells a rejected key apart from other failures", async () => {
  assert.equal(isRejectedKey(await apiError("x", new Response("", { status: 401 }))), true);
  assert.equal(isRejectedKey(await apiError("x", new Response("", { status: 403 }))), true);
  assert.equal(isRejectedKey(await apiError("x", new Response("", { status: 500 }))), false);
  assert.equal(isRejectedKey(new Error("fetch failed")), false);
});
