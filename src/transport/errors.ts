export class AmpersandApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AmpersandApiError";
  }
}

/** Ampersand Bridge refused the key itself, as opposed to a network or server failure. */
export function isRejectedKey(error: unknown): boolean {
  return error instanceof AmpersandApiError && (error.status === 401 || error.status === 403);
}

export async function apiError(prefix: string, response: Response): Promise<AmpersandApiError> {
  const text = (await response.text().catch(() => "")).trim();
  let detail = text;
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string } | string;
      detail?: string;
      message?: string;
      title?: string;
    };
    detail =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? json.detail ?? json.message ?? json.title ?? text;
  } catch {
    /* Use the response text as-is. */
  }
  return new AmpersandApiError(
    `${prefix} (HTTP ${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`,
    response.status,
  );
}
