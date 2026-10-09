import * as vscode from "vscode";
import { joinTextParts, stringifyWellFormedJson } from "../transport/unicode";

export interface ApiMessage {
  role: "user" | "assistant" | "tool";
  content: string | ApiContentPart[] | null;
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
}

interface ApiContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}
interface ApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  imageInput: boolean,
): ApiMessage[] {
  const converted = messages.flatMap((message) => convertMessage(message, imageInput));
  const filtered = converted.filter((message) =>
    Boolean(message.tool_calls?.length || message.tool_call_id || message.content),
  );
  if (filtered[0]?.role === "assistant")
    filtered.unshift({
      role: "user",
      content: "Continue from the previous assistant response.",
    });
  return filtered.length ? filtered : [{ role: "user", content: "" }];
}

export function messageToText(message: vscode.LanguageModelChatRequestMessage): string {
  return joinTextParts(message.content.map(inputPartText));
}

function convertMessage(message: vscode.LanguageModelChatRequestMessage, imageInput: boolean): ApiMessage[] {
  const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
  const text: string[] = [];
  const images: ApiContentPart[] = [];
  const toolCalls: ApiToolCall[] = [];
  const results: ApiMessage[] = [];
  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) text.push(part.value);
    else if (part instanceof vscode.LanguageModelToolCallPart)
      toolCalls.push({
        id: part.callId,
        type: "function",
        function: {
          name: part.name,
          arguments: stringifyWellFormedJson(part.input ?? {}),
        },
      });
    else if (part instanceof vscode.LanguageModelToolResultPart)
      results.push({
        role: "tool",
        tool_call_id: part.callId,
        content: joinTextParts(part.content.map(inputPartText)),
      });
    else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      if (!imageInput) throw new Error("The selected Ampersand Bridge model does not advertise image input support.");
      images.push({
        type: "image_url",
        image_url: {
          url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}`,
        },
      });
    }
  }
  const plainText = joinTextParts(text);
  const content: string | ApiContentPart[] = images.length
    ? [...(plainText ? [{ type: "text" as const, text: plainText }] : []), ...images]
    : plainText;
  const current: ApiMessage = role === "assistant" && toolCalls.length
    ? { role, content: content || null, tool_calls: toolCalls }
    : { role, content };
  // Tool results settle the preceding assistant calls before new user text.
  if (results.length) return [...results, ...(content || current.tool_calls?.length ? [current] : [])];
  return [current];
}

function inputPartText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (part instanceof vscode.LanguageModelToolCallPart) return stringifyWellFormedJson(part.input ?? {});
  if (part instanceof vscode.LanguageModelToolResultPart) return joinTextParts(part.content.map(inputPartText));
  if (part instanceof vscode.LanguageModelDataPart) return `[${part.mimeType} data omitted]`;
  return typeof part === "string" ? part : "";
}
