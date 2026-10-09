export const API_ORIGIN = "https://api.aiand.com";
export const API_BASE = `${API_ORIGIN}/v1`;

export const AMPERSAND_ENDPOINTS = {
  models: `${API_BASE}/models`,
  chat: `${API_BASE}/chat/completions`,
  balance: `${API_ORIGIN}/billing/balance`,
} as const;

export function extensionUserAgent(version: string, vscodeVersion: string): string {
  return `ampersand-bridge-copilot-chat/${version} VSCode/${vscodeVersion}`;
}

export function ampersandHeaders(apiKey: string, accept: string, userAgent: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: accept,
    "User-Agent": userAgent,
  };
}
