import * as vscode from "vscode";
import { resolveMaxOutputTokens } from "../models/catalog";
import { applyReasoningEffort, type ReasoningEffort } from "../models/options";
import { trimHistoryToFit } from "./history-trim";
import { convertMessages } from "./messages";

export function buildRequest(
  model: string,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  reasoningEffort: ReasoningEffort | undefined,
  advertisedMaxTokens: number,
  configuredMaxTokens: number,
  imageInput: boolean,
  contextCapTokens?: number,
): Record<string, unknown> {
  const maxTokens = resolveMaxOutputTokens(configuredMaxTokens, advertisedMaxTokens);
  const convertedMessages = convertMessages(messages, imageInput);
  const requestMessages = contextCapTokens === undefined
    ? convertedMessages
    : [...trimHistoryToFit(convertedMessages, contextCapTokens).items];
  const tools = (options.tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeSchema(tool.inputSchema),
    },
  }));
  const body = {
    model,
    messages: requestMessages,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: maxTokens,
    ...(tools.length
      ? {
          tools,
          tool_choice: toolMode(options.toolMode),
          parallel_tool_calls: true,
        }
      : {}),
  };
  return applyReasoningEffort(body, reasoningEffort);
}

function sanitizeSchema(schema: unknown): Record<string, unknown> {
  return schema && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as Record<string, unknown>)
    : { type: "object", properties: {} };
}

function toolMode(mode: vscode.LanguageModelChatToolMode | undefined): "auto" | "required" {
  return mode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";
}
