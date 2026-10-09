export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatStreamEvent {
  text?: string;
  reasoning?: string;
  toolCalls?: PendingToolCall[];
  usage?: Record<string, unknown>;
  done?: boolean;
  finishReason?: string;
}

export class ChatCompletionStreamParser {
  private buffer = "";
  private readonly pendingTools = new Map<string, PendingToolCall>();
  private readonly toolAliases = new Map<string, string>();
  private lastFinishReason: string | undefined;
  private sawText = false;
  private sawToolCall = false;

  get finishReason(): string | undefined { return this.lastFinishReason; }

  /**
   * Rejects truncated or empty streams: the finish reason must be known, a
   * tool-call finish must have produced a tool call, and the stream must have
   * returned an answer or a tool call at all.
   */
  validateCompletion(requiresToolCall = false): void {
    validateStreamCompletion(this.lastFinishReason);
    if ((requiresToolCall || this.lastFinishReason === "tool_calls" || this.lastFinishReason === "function_call")
      && !this.sawToolCall) {
      throw new Error("Ampersand Bridge completed without the required tool call");
    }
    if (!this.sawText && !this.sawToolCall) {
      throw new Error("Ampersand Bridge completed without returning an answer or tool call");
    }
  }

  push(chunk: string): ChatStreamEvent[] {
    this.buffer += chunk;
    const events: ChatStreamEvent[] = [];
    let boundary = /\r?\n\r?\n/.exec(this.buffer);
    while (boundary?.index !== undefined) {
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const event = this.parseBlock(block);
      if (event) events.push(event);
      boundary = /\r?\n\r?\n/.exec(this.buffer);
    }
    return events;
  }

  finish(): ChatStreamEvent[] {
    const events: ChatStreamEvent[] = [];
    const trailing = this.parseBlock(this.buffer);
    this.buffer = "";
    if (trailing) events.push(trailing);
    const tools = this.flushTools();
    if (tools.length) events.push({ toolCalls: tools });
    return events;
  }

  private parseBlock(block: string): ChatStreamEvent | undefined {
    const lines = block.split(/\r?\n/);
    // The service may emit a named `event: metrics` trailer after
    // `data: [DONE]` (cost/TTFT payload when the request opts into metrics).
    // It carries no chat content, so ignore non-default SSE event blocks.
    const eventName = lines
      .filter((line) => line.startsWith("event:"))
      .map((line) => line.slice(6).trim())
      .pop();
    if (eventName && eventName !== "message") return undefined;
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return undefined;
    if (data === "[DONE]") {
      const toolCalls = this.flushTools();
      return { done: true, ...(toolCalls.length ? { toolCalls } : {}) };
    }

    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return undefined;
    }
    if (!isRecord(json)) return undefined;
    // Do not surface upstream bodies, which may echo private prompt context.
    if (json.error) throw new Error("Ampersand Bridge response stream reported an API error");

    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : undefined;
    const delta = isRecord(choice?.delta) ? choice.delta : {};
    this.collectTools(delta.tool_calls);

    const finishReason = typeof choice?.finish_reason === "string" && choice.finish_reason
      ? choice.finish_reason
      : undefined;
    if (finishReason) this.lastFinishReason = finishReason;
    const toolCalls = finishReason ? this.flushTools() : [];
    const text = typeof delta.content === "string" ? delta.content : undefined;
    if (text?.trim()) this.sawText = true;
    const reasoning = [delta.reasoning_content, delta.reasoning]
      .find((value): value is string => typeof value === "string" && value.length > 0);
    const usage = isRecord(json.usage) ? json.usage : undefined;

    if (!text && !reasoning && !toolCalls.length && !usage && !finishReason) return undefined;
    return {
      ...(text ? { text } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
  }

  private collectTools(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const [position, raw] of value.entries()) {
      if (!isRecord(raw)) continue;
      const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
      const index = typeof raw.index === "number" ? `index:${raw.index}` : undefined;
      const idAlias = id ? `id:${id}` : undefined;
      const key = (index && this.toolAliases.get(index)) ?? (idAlias && this.toolAliases.get(idAlias)) ?? index ?? idAlias ?? `slot:${position}`;
      const current = this.pendingTools.get(key) ?? { id: "", name: "", arguments: "" };
      if (id) current.id = id;
      if (index) this.toolAliases.set(index, key);
      if (idAlias) this.toolAliases.set(idAlias, key);
      const fn = isRecord(raw.function) ? raw.function : undefined;
      if (typeof fn?.name === "string" && fn.name) {
        if (!current.name || fn.name.startsWith(current.name)) current.name = fn.name;
        else if (fn.name !== current.name) current.name += fn.name;
      }
      if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
      this.pendingTools.set(key, current);
    }
  }

  private flushTools(): PendingToolCall[] {
    const tools = [...this.pendingTools.values()].filter((tool) => tool.name).map(completeToolCall);
    if (tools.length) this.sawToolCall = true;
    this.pendingTools.clear();
    this.toolAliases.clear();
    return tools;
  }
}

export function validateStreamCompletion(finishReason: string | undefined): void {
  if (finishReason === "stop" || finishReason === "tool_calls" || finishReason === "function_call") return;
  if (!finishReason) throw new Error("Ampersand response stream ended before a completion reason was received");
  if (finishReason === "length") throw new Error("Ampersand response reached its output token limit before completing");
  if (finishReason === "content_filter") throw new Error("Ampersand stopped the response because of its content filter");
  throw new Error(`Ampersand response ended with finish reason: ${finishReason}`);
}

function completeToolCall(tool: PendingToolCall): PendingToolCall {
  const args = tool.arguments.trim() || "{}";
  try {
    JSON.parse(args);
  } catch {
    throw new Error(`Ampersand response stream ended with incomplete arguments for tool ${tool.name}`);
  }
  return { ...tool, arguments: args };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
