import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import { trimHistoryToFit } from "./history-trim";

class TextPart { constructor(readonly value: string) {} }
class ToolCallPart { constructor(readonly callId: string, readonly name: string, readonly input: object) {} }
class ToolResultPart { constructor(readonly callId: string, readonly content: unknown[]) {} }
class DataPart { constructor(readonly data: Uint8Array, readonly mimeType: string) {} }

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id === "vscode") return {
    LanguageModelTextPart: TextPart,
    LanguageModelToolCallPart: ToolCallPart,
    LanguageModelToolResultPart: ToolResultPart,
    LanguageModelDataPart: DataPart,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  };
  return originalLoad.call(this, id, ...args);
};
let messages: typeof import("./messages");
try { messages = require("./messages"); } finally { loader._load = originalLoad; }

function message(content: unknown[], role = 1): vscode.LanguageModelChatRequestMessage {
  return { role, content, name: undefined } as unknown as vscode.LanguageModelChatRequestMessage;
}

test("keeps parallel tool results ahead of accompanying user text", () => {
  const converted = messages.convertMessages([
    message([new TextPart("Read files")]),
    message([new ToolCallPart("one", "read", {}), new ToolCallPart("two", "read", {})], 2),
    message([new ToolResultPart("one", [new TextPart("first")]), new TextPart("Summarize both"),
      new ToolResultPart("two", [new TextPart("second")])]),
  ], false);
  assert.deepEqual(converted.map((item) => item.role), ["user", "assistant", "tool", "tool", "user"]);
  assert.deepEqual(converted.slice(2, 4).map((item) => item.tool_call_id), ["one", "two"]);
  assert.equal(converted[4].content, "Summarize both");
  const trimmed = trimHistoryToFit(converted, 1).items;
  assert.deepEqual(trimmed.slice(1, 4).map((item) => item.role), ["assistant", "tool", "tool"]);
});

test("does not insert an empty user message before a tool result", () => {
  assert.deepEqual(messages.convertMessages([message([new ToolResultPart("one", [new TextPart("result")])])], false),
    [{ role: "tool", tool_call_id: "one", content: "result" }]);
});

test("preserves split emoji in text and nested tool results", () => {
  const input = message([new TextPart("status \uD83D"), new TextPart("\uDFE2"),
    new ToolResultPart("one", [new TextPart("file \uD83D"), new TextPart("\uDE80"),
      new ToolResultPart("nested", [new TextPart("\uD83D"), new TextPart("\uDCCB")])])]);
  const converted = messages.convertMessages([input], false);
  assert.equal(converted[0].content, "file 🚀\n📋");
  assert.equal(converted[1].content, "status 🟢");
  assert.equal(messages.messageToText(input), "status 🟢\nfile 🚀\n📋");
});

test("normalizes embedded tool arguments and keeps image support checks", () => {
  const [converted] = messages.convertMessages([
    message([new TextPart("anchor")]),
    message([new ToolCallPart("one", "read", { text: "\uD800", nested: ["🟢", "\uDC00"] })], 2),
  ], false).slice(1);
  assert.deepEqual(JSON.parse(converted.tool_calls![0].function.arguments), { text: "�", nested: ["🟢", "�"] });
  const image = message([new DataPart(new Uint8Array([0, 1, 2]), "image/png")]);
  assert.throws(() => messages.convertMessages([image], false), /does not advertise image/);
  assert.match(JSON.stringify(messages.convertMessages([image], true)), /data:image\/png;base64,AAEC/);
});
