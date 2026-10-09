import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import { AMPERSAND_ENDPOINTS } from "./transport/protocol";

class TextPart { constructor(readonly value: string) {} }
class ToolCallPart { constructor(readonly callId: string, readonly name: string, readonly input: object) {} }
class ToolResultPart { constructor(readonly callId: string, readonly content: unknown[]) {} }
class DataPart { constructor(readonly data: Uint8Array, readonly mimeType: string) {} }
class EventEmitter {
  readonly event = (): vscode.Disposable => ({ dispose() {} });
  fire(): void {}
}

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id === "vscode") return {
    EventEmitter,
    LanguageModelTextPart: TextPart,
    LanguageModelToolCallPart: ToolCallPart,
    LanguageModelToolResultPart: ToolResultPart,
    LanguageModelDataPart: DataPart,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    LanguageModelChatToolMode: { Auto: 1, Required: 2 },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    window: { showWarningMessage: async () => undefined },
  };
  return originalLoad.call(this, id, ...args);
};
let Provider: typeof import("./provider").AmpersandProvider;
try { Provider = require("./provider").AmpersandProvider; } finally { loader._load = originalLoad; }

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as vscode.CancellationToken;
const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function setup(stream: string, catalog: unknown = { data: [{ id: "openai/gpt-oss-120b" }] }, holdOpen = false): {
  provider: InstanceType<typeof Provider>; requests: RequestInit[]; cancelled: () => boolean;
} {
  const requests: RequestInit[] = [];
  let cancelled = false;
  const fetchImpl: typeof fetch = async (url, init) => {
    if (url === AMPERSAND_ENDPOINTS.models) return json(catalog);
    if (url === "https://models.dev/api.json") return json({ aiand: { models: {} } });
    assert.equal(url, AMPERSAND_ENDPOINTS.chat);
    requests.push(init ?? {});
    const bytes = new TextEncoder().encode(stream);
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); },
      cancel() { cancelled = true; },
      pull(controller) { if (!holdOpen) controller.close(); },
    }));
  };
  return { provider: new Provider(output, "fixture-agent", undefined, undefined, fetchImpl), requests,
    cancelled: () => cancelled };
}

async function nativeModel(provider: InstanceType<typeof Provider>): Promise<import("./provider").AmpersandModel> {
  const [model] = await provider.provideLanguageModelChatInformation(
    { configuration: { entryId: "work", apiKey: "entry-fixture" } },
    token,
  );
  assert.ok(model);
  return model;
}

const userMessage = { role: 1, content: [new TextPart("public fixture")] } as unknown as vscode.LanguageModelChatRequestMessage;
const options: vscode.ProvideLanguageModelChatResponseOptions = { toolMode: 1, requestInitiator: "test" };

test("uses the native entry key and validates the streamed answer", async () => {
  const { provider, requests } = setup('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\r\n\r\n');
  const model = await nativeModel(provider);
  const parts: unknown[] = [];
  await provider.provideLanguageModelChatResponse(model, [userMessage], options, { report: (part) => parts.push(part) }, token);
  assert.equal((requests[0].headers as Record<string, string>).Authorization, "Bearer entry-fixture");
  assert.equal((parts[0] as TextPart).value, "ok");
});

test("required-tool validation is wired into the provider response lifecycle", async () => {
  const { provider } = setup('data: {"choices":[{"delta":{"content":"text only"},"finish_reason":"stop"}]}\n\n');
  const model = await nativeModel(provider);
  await assert.rejects(provider.provideLanguageModelChatResponse(model, [userMessage], {
    ...options,
    toolMode: 2,
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
  }, { report() {} }, token), /required tool call/);
});

test("cancels the response body when stream parsing fails", async () => {
  const { provider, cancelled } = setup('data: {"error":{"message":"private fixture"}}\n\n', undefined, true);
  const model = await nativeModel(provider);
  await assert.rejects(provider.provideLanguageModelChatResponse(model, [userMessage], options, { report() {} }, token),
    /stream reported an API error/);
  assert.equal(cancelled(), true);
});

test("keeps a successful empty catalog across discovery calls", async () => {
  const { provider } = setup("", { data: [] });
  assert.deepEqual(await provider.provideLanguageModelChatInformation(
    { configuration: { entryId: "work", apiKey: "entry-fixture" } }, token,
  ), []);
  assert.deepEqual(await provider.provideLanguageModelChatInformation(
    { configuration: { entryId: "work", apiKey: "entry-fixture" } }, token,
  ), []);
});

test("lists no models when the service refuses the entry key", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    if (url === AMPERSAND_ENDPOINTS.models) return new Response("denied", { status: 401 });
    if (url === "https://models.dev/api.json") return json({ aiand: { models: {} } });
    throw new Error(`unexpected fetch ${String(url)}`);
  };
  const provider = new Provider(output, "fixture-agent", undefined, undefined, fetchImpl);
  const configuration = { configuration: { entryId: "work", apiKey: "entry-fixture" } };
  assert.deepEqual(await provider.provideLanguageModelChatInformation(configuration, token), []);
  // The refused key stays refused across repeat queries within the cache window.
  assert.deepEqual(await provider.provideLanguageModelChatInformation(configuration, token), []);
});
