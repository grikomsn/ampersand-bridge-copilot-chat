const assert = require("node:assert/strict");
const vscode = require("vscode");
const { AmpersandProvider } = require("../../out/provider");

/** Real VS Code parts and cancellation, synthetic HTTP and credentials only. */
async function run() {
  const source = new vscode.CancellationTokenSource();
  const values = new Map();
  const state = { get: (key) => values.get(key), update: async (key, value) => { values.set(key, value); } };
  const sent = [];
  const signals = [];
  let streamMode = "tools";
  let directoryEmpty = false;
  let pendingBalance;
  const event = (delta, finish_reason, usage) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }], usage })}\r\n\r\n`;
  const fetcher = async (url, init = {}) => {
    const path = String(url);
    const authorization = new Headers(init.headers).get("Authorization");
    if (path.includes("models.dev")) return Response.json({});
    if (path.endsWith("/models")) return Response.json({ data: directoryEmpty ? [] : [
      { id: "deepseek-ai/deepseek-v4.1-flash", tool_calling: true, context_length: 32768, max_output_tokens: 4096,
        reasoning_efforts: ["none", "high"], reasoning_effort_default: "none" },
      { id: "synthetic-byok", tool_calling: true, context_length: 32768, max_output_tokens: 4096 },
    ] });
    if (path.endsWith("/billing/balance")) {
      if (pendingBalance) { const callback = pendingBalance; pendingBalance = undefined; return callback(); }
      const credits = authorization === "Bearer synthetic_a" ? 111 : 222;
      return Response.json({ balance: credits, credits, currency: "usd", usable_requests: null });
    }
    assert.ok(path.endsWith("/chat/completions"));
    const body = JSON.parse(init.body);
    sent.push({ authorization, body });
    signals.push(init.signal);
    const followUp = body.messages.some((message) => message.role === "tool");
    const name = body.tools?.[0]?.function.name ?? "read";
    if (streamMode === "error") {
      let first = true;
      return new Response(new ReadableStream({ pull(controller) {
        if (first) { first = false; controller.enqueue(new TextEncoder().encode(event({ reasoning_content: "synthetic" }))); }
        else controller.error(new Error("synthetic stream failure"));
      } }));
    }
    if (streamMode === "incomplete") return new Response(event({ reasoning_content: "synthetic" }));
    if (streamMode === "cancel") return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(event({ content: "synthetic" })));
      init.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    } }));
    const content = followUp ? event({ content: "synthetic final" }, "stop", { prompt_tokens: 10, completion_tokens: 5 }) :
      event({ reasoning_content: "synthetic plan" }) + event({ tool_calls: [
        { index: 0, id: "a", function: { name, arguments: '{"value":"' } },
        { index: 1, id: "b", function: { name, arguments: '{"value":"' } },
        { index: 2, function: { name, arguments: '{}' } },
      ] }) + event({ tool_calls: [{ id: "b", function: { arguments: 'b"}' } }] }) +
      event({ tool_calls: [{ id: "a", function: { arguments: 'a"}' } }] }, "tool_calls", { prompt_tokens: 10, completion_tokens: 5 });
    return new Response(new ReadableStream({ start(controller) {
      for (const character of content + "data: [DONE]\r\n\r\n") controller.enqueue(new TextEncoder().encode(character));
      controller.close();
    } }));
  };
  const provider = new AmpersandProvider({ appendLine() {} }, "native-test", state, {}, fetcher);
  const prepare = async (apiKey) => provider.provideLanguageModelChatInformation({ silent: true,
    configuration: { apiKey, name: "Same label" } }, source.token);
  const options = { requestInitiator: "native-test", tools: [{ name: "read", description: "Synthetic", inputSchema: { type: "object" } }] };
  try {
    const aModels = await prepare("synthetic_a");
    const bModels = await prepare("synthetic_b");
    const a = aModels.find((model) => model.rawModelId === "deepseek-ai/deepseek-v4.1-flash");
    const b = bModels.find((model) => model.rawModelId === "synthetic-byok");
    assert.equal(a.id, "deepseek-ai/deepseek-v4.1-flash", "Model ids are raw hosted ids; the host namespaces per group");
    assert.notEqual(a.credentialRef, b.credentialRef);
    assert.equal(provider.getFeatureApiKey(), "synthetic_b", "Active key follows the most recent provisioning");
    const output = [];
    await provider.provideLanguageModelChatResponse(a, [vscode.LanguageModelChatMessage.User("synthetic prompt")], options,
      { report: (part) => output.push(part) }, source.token);
    const calls = output.filter((part) => part instanceof vscode.LanguageModelToolCallPart);
    assert.equal(calls.length, 3);
    assert.equal(new Set(calls.map((part) => part.callId)).size, 3);
    assert.equal(output[1].metadata.vscode_reasoning_done, true);
    assert.equal(sent.at(-1).authorization, "Bearer synthetic_a");
    assert.equal(sent.at(-1).body.model, "deepseek-ai/deepseek-v4.1-flash");
    assert.equal(sent.at(-1).body.reasoning_effort, "high");
    const history = [vscode.LanguageModelChatMessage.User("synthetic prompt"), vscode.LanguageModelChatMessage.Assistant(calls),
      vscode.LanguageModelChatMessage.User(calls.map((call) => new vscode.LanguageModelToolResultPart(call.callId,
        [new vscode.LanguageModelTextPart("synthetic result")])))];
    await provider.provideLanguageModelChatResponse(b, history, options, { report() {} }, source.token);
    assert.equal(sent.at(-1).body.messages.filter((message) => message.role === "tool").length, 3);
    assert.equal(sent.at(-1).body.model, "synthetic-byok");
    assert.equal(sent.at(-1).authorization, "Bearer synthetic_b");
    assert.equal(provider.getUsageSnapshot(a.credentialRef).tracked.requests, 1);
    assert.equal(provider.getUsageSnapshot(b.credentialRef).tracked.requests, 1);
    await provider.refreshUsage(a.credentialRef);
    assert.equal(provider.getUsageSnapshot(a.credentialRef).account.credits, 111);
    await provider.refreshUsage(b.credentialRef);
    assert.equal(provider.getUsageSnapshot(b.credentialRef).account.credits, 222);
    assert.equal(provider.getUsageSnapshot(a.credentialRef).account.credits, 111);
    const persisted = values.get("ampersandBridge.entryUsage.v1");
    assert.equal(Object.values(persisted).some((snapshot) => snapshot.account), false);
    let releaseBalance;
    pendingBalance = () => new Promise((resolve) => { releaseBalance = resolve; });
    const oldRefresh = provider.refreshUsage(a.credentialRef);
    while (!releaseBalance) await new Promise((resolve) => setImmediate(resolve));
    const rotated = (await prepare("synthetic_rotated"))[0];
    releaseBalance(Response.json({ balance: 999, credits: 999, currency: "usd", usable_requests: null }));
    await oldRefresh;
    assert.equal(provider.getUsageSnapshot(rotated.credentialRef).account, undefined);
    // Key-scoped credentials keep handles valid while their key stays provisioned.
    assert.equal(provider.getFeatureApiKey(), "synthetic_rotated");
    const returned = (await prepare("synthetic_a"))[0];
    assert.equal(returned.id, a.id);
    assert.equal(returned.credentialRef, a.credentialRef);
    assert.equal(provider.getFeatureApiKey(), "synthetic_a", "Rotate-back restores the active key");
    for (const mode of ["incomplete", "error"]) {
      streamMode = mode;
      const parts = [];
      await assert.rejects(provider.provideLanguageModelChatResponse(returned, [], options,
        { report: (part) => parts.push(part) }, source.token), mode === "incomplete" ? /completion reason/ : /synthetic stream failure/);
      assert.equal(parts.at(-1).metadata.vscode_reasoning_done, true);
      assert.equal(signals.at(-1).aborted, true);
    }
    streamMode = "cancel";
    const cancellation = new vscode.CancellationTokenSource();
    await provider.provideLanguageModelChatResponse(returned, [], options, { report() { cancellation.cancel(); } }, cancellation.token);
    assert.equal(signals.at(-1).aborted, true);
    cancellation.dispose();
    directoryEmpty = true;
    assert.deepEqual(await prepare("synthetic_empty"), []);
    assert.equal(provider.getFeatureApiKey(), "synthetic_empty");
  } finally {
    source.dispose();
  }
  console.log(JSON.stringify({ provider: "ampersand-bridge", passed: true,
    nativeChecks: "parallel entries, reasoning closure, raw routing, tool follow-up, inference usage, balance isolation, stale refresh, rotation, rotate-back, incomplete/error/cancellation cleanup" }));
}
module.exports = { run };
