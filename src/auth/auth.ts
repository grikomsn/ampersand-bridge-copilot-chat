import { createHash } from "node:crypto";

/**
 * Stable, non-reversible credential fingerprint used to scope catalogs and
 * usage per native provider entry. VS Code owns the API keys themselves.
 */
export function credentialReference(apiKey: string): string {
  return createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 16);
}
