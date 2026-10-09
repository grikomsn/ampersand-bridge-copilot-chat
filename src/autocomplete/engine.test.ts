import assert from "node:assert/strict";
import test from "node:test";
import { ChatCompletionEngine, parseSseContentDelta } from "./engine";
import { AMPERSAND_ENDPOINTS } from "../transport/protocol";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

test("parses visible content and ignores reasoning-only events", () => {
  assert.equal(parseSseContentDelta(JSON.stringify({ choices: [{ delta: { content: "code" } }] })), "code");
  assert.equal(parseSseContentDelta(JSON.stringify({ choices: [{ text: "legacy" }] })), "legacy");
  assert.equal(parseSseContentDelta(JSON.stringify({ choices: [{ delta: { reasoning_content: "secret" } }] })), "");
  assert.equal(parseSseContentDelta("not json"), "");
  assert.equal(parseSseContentDelta(JSON.stringify({ choices: [] })), "");
});

test("streams a completion and sends the reasoning-off payload", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const engine = new ChatCompletionEngine({
    url: AMPERSAND_ENDPOINTS.chat,
    headers: { Authorization: "Bearer test-key" },
    timeoutMs: 1_000,
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "out.append" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ]);
    },
  });
  const result = await engine.complete(
    { prefix: "p", suffix: "s", modelId: "deepseek-ai/deepseek-v4-flash", maxTokens: 128, reasoningEfforts: ["none", "high"] },
    new AbortController().signal,
  );
  assert.equal(result.text, "out.append");
  const body = JSON.parse(String(requests[0]?.init.body)) as {
    model: string;
    reasoning_effort?: string;
    stream: boolean;
    max_tokens: number;
    temperature: number;
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(requests[0]?.url, AMPERSAND_ENDPOINTS.chat);
  assert.equal(body.model, "deepseek-ai/deepseek-v4-flash");
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 128);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.messages.map((message) => message.role), ["system", "user"]);
  const headers = requests[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
});

test("omits the effort switch for models without reasoning control", async () => {
  const requests: RequestInit[] = [];
  const engine = new ChatCompletionEngine({
    url: AMPERSAND_ENDPOINTS.chat,
    headers: {},
    timeoutMs: 1_000,
    fetcher: async (_url, init) => {
      requests.push(init ?? {});
      return sseResponse(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n', "data: [DONE]\n\n"]);
    },
  });
  await engine.complete(
    { prefix: "p", suffix: "s", modelId: "google/gemma-4-31b-it", maxTokens: 16 },
    new AbortController().signal,
  );
  const body = JSON.parse(String(requests[0]?.body)) as { reasoning_effort?: string };
  assert.equal(body.reasoning_effort, undefined);
});

test("never echoes upstream error bodies", async () => {
  const engine = new ChatCompletionEngine({
    url: AMPERSAND_ENDPOINTS.chat,
    headers: {},
    timeoutMs: 1_000,
    fetcher: async () => new Response('{"error":"prompt context leak"}', { status: 401 }),
  });
  await assert.rejects(
    engine.complete({ prefix: "p", suffix: "s", modelId: "deepseek-ai/deepseek-v4-flash", maxTokens: 8 }, new AbortController().signal),
    (error: unknown) => error instanceof Error && error.message === "Ampersand Bridge completion request failed (401)",
  );
});

test("aborted caller signal surfaces as a quiet no-result", async () => {
  const controller = new AbortController();
  const engine = new ChatCompletionEngine({
    url: AMPERSAND_ENDPOINTS.chat,
    headers: {},
    timeoutMs: 1_000,
    fetcher: async (_url, init) => {
      controller.abort();
      assert.equal((init?.signal as AbortSignal).aborted, true);
      throw new DOMException("aborted", "AbortError");
    },
  });
  const result = await engine.complete(
    { prefix: "p", suffix: "s", modelId: "deepseek-ai/deepseek-v4-flash", maxTokens: 8 },
    controller.signal,
  );
  assert.equal(result.text, undefined);
});
