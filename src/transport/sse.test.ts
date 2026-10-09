import assert from "node:assert/strict";
import test from "node:test";
import { ChatCompletionStreamParser, validateStreamCompletion } from "./sse";

test("parses fragmented Ampersand Bridge text, reasoning, usage, and tool calls", () => {
  const parser = new ChatCompletionStreamParser();
  const events = [
    ...parser.push('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n'),
    ...parser.push('\ndata: {"choices":[{"delta":{"content":"Pool"}}]}\n\n'),
    ...parser.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"first-id","function":{"name":"get_weather","arguments":""}}]}}]}\n\n'),
    ...parser.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"final-id","function":{"name":null,"arguments":"{\\"city\\":\\"Jak"}}]}}]}\n\n'),
    ...parser.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"final-id","function":{"name":null,"arguments":"arta\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":140,"completion_tokens":2}}\n\n'),
    ...parser.push("data: [DONE]\n\n"),
    ...parser.finish(),
  ];

  assert.equal(events[0].reasoning, "think");
  assert.equal(events[1].text, "Pool");
  assert.equal(events[2].toolCalls?.[0].id, "final-id");
  assert.equal(events[2].toolCalls?.[0].name, "get_weather");
  assert.deepEqual(JSON.parse(events[2].toolCalls?.[0].arguments ?? ""), { city: "Jakarta" });
  assert.equal(events[2].usage?.prompt_tokens, 140);
  assert.equal(events[3].done, true);
});

test("ignores comments and malformed event blocks", () => {
  const parser = new ChatCompletionStreamParser();
  assert.deepEqual(parser.push(": keep-alive\n\n"), []);
  assert.deepEqual(parser.push("data: not-json\n\n"), []);
  for (const data of ["null", "[]", "42", '"text"']) assert.deepEqual(parser.push(`data: ${data}\n\n`), []);
  assert.deepEqual(parser.finish(), []);
});

test("preserves SSE events with CRLF split at every possible chunk boundary", () => {
  const stream = 'data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\n'
    + 'data: {"choices":[{"delta":{"content":"b"},"finish_reason":"stop"}]}\r\n\r\n'
    + "data: [DONE]\r\n\r\n";
  for (let split = 1; split < stream.length; split++) {
    const parser = new ChatCompletionStreamParser();
    const events = [...parser.push(stream.slice(0, split)), ...parser.push(stream.slice(split)), ...parser.finish()];
    assert.equal(events.map((event) => event.text ?? "").join(""), "ab", `split ${split}`);
    assert.equal(events.at(-1)?.done, true);
    assert.doesNotThrow(() => parser.validateCompletion());
  }
  const bytewise = new ChatCompletionStreamParser();
  const events = [...stream].flatMap((chunk) => bytewise.push(chunk));
  assert.equal(events.map((event) => event.text ?? "").join(""), "ab");
});

test("rejects empty and reasoning-only completions", () => {
  for (const delta of [{}, { content: " \n" }, { reasoning_content: "thinking" }]) {
    const parser = new ChatCompletionStreamParser();
    parser.push(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: "stop" }] })}\n\n`);
    assert.throws(() => parser.validateCompletion(), /without returning an answer/);
  }
});

test("requires an actual tool call when requested or claimed by the finish reason", () => {
  const text = new ChatCompletionStreamParser();
  text.push('data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n');
  assert.doesNotThrow(() => text.validateCompletion());
  assert.throws(() => text.validateCompletion(true), /required tool call/);
  const claimed = new ChatCompletionStreamParser();
  claimed.push('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
  assert.throws(() => claimed.validateCompletion(), /required tool call/);
  const tool = new ChatCompletionStreamParser();
  tool.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"one","function":{"name":"echo","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n');
  assert.doesNotThrow(() => tool.validateCompletion(true));
});

test("surfaces streamed errors without including upstream response contents", () => {
  const parser = new ChatCompletionStreamParser();
  assert.throws(() => parser.push('data: {"error":{"message":"private fixture"}}\n\n'),
    (error: unknown) => error instanceof Error && error.message === "Ampersand Bridge response stream reported an API error");
});

test("ignores the Ampersand Bridge metrics trailer after the done marker", () => {
  const parser = new ChatCompletionStreamParser();
  const events = [
    ...parser.push('data: {"choices":[{"delta":{"content":"hi"}}],"usage":{"prompt_tokens":7}}\n\n'),
    ...parser.push("data: [DONE]\n\n"),
    ...parser.push('event: metrics\ndata: {"tokens":{"input":7,"output":2},"cost":0.000018}\n\n'),
    ...parser.finish(),
  ];
  assert.equal(events[0].text, "hi");
  assert.equal(events[1].done, true);
  assert.equal(events.length, 2);
});

test("rejects incomplete tool arguments and normalizes empty arguments", () => {
  const incomplete = new ChatCompletionStreamParser();
  assert.throws(
    () => incomplete.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"lookup","arguments":"{"}}]},"finish_reason":"tool_calls"}]}\n\n'),
    /incomplete arguments for tool lookup/,
  );

  const empty = new ChatCompletionStreamParser();
  const events = empty.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"now","arguments":""}}]},"finish_reason":"tool_calls"}]}\n\n');
  assert.equal(events[0].toolCalls?.[0].arguments, "{}");
});

test("routes ID-only fragments back to their indexed parallel calls", () => {
  const parser = new ChatCompletionStreamParser();
  const event = (delta: unknown, finish_reason?: string): string => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`;
  const input = event({ tool_calls: [
    { index: 0, id: "a", function: { name: "read", arguments: '{"file":"' } },
    { index: 1, id: "b", function: { name: "read", arguments: '{"file":"' } },
  ] }) + event({ tool_calls: [{ id: "b", function: { name: "read", arguments: 'b"}' } }] }) +
    event({ tool_calls: [{ id: "a", function: { arguments: 'a"}' } }] }, "tool_calls");
  const events = [...input].flatMap((character) => parser.push(character));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].toolCalls, [
    { id: "a", name: "read", arguments: '{"file":"a"}' },
    { id: "b", name: "read", arguments: '{"file":"b"}' },
  ]);
  assert.deepEqual(parser.finish(), []);
});

test("streams text before EOF across split CRLF boundaries", () => {
  const parser = new ChatCompletionStreamParser();
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"first"}}]}\r'), []);
  assert.deepEqual(parser.push('\n\r'), []);
  assert.deepEqual(parser.push('\n'), [{ text: "first" }]);
  assert.throws(() => parser.validateCompletion(), /before a completion reason/);
});

test("validates stream completion reasons", () => {
  assert.doesNotThrow(() => validateStreamCompletion("stop"));
  assert.doesNotThrow(() => validateStreamCompletion("tool_calls"));
  assert.throws(() => validateStreamCompletion(undefined), /before a completion reason/);
  assert.throws(() => validateStreamCompletion("length"), /output token limit/);
});
