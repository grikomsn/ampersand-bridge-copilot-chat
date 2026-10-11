import { credentialReference } from "./auth/auth";

/** Extracts the VS Code-owned API key from a native provider entry configuration. */
export function apiKeyFromConfiguration(configuration: Readonly<Record<string, unknown>>): string | undefined {
  const value = configuration.apiKey;
  const apiKey = typeof value === "string" ? value.trim() : "";
  return apiKey || undefined;
}

/**
 * In-memory registry of the API keys VS Code supplied during provisioning.
 * Keys stay in memory only; entry groups are the sole user-facing identity and
 * the host namespaces model identifiers per group, so no entry IDs are tracked.
 */
export class Credentials {
  private readonly entries = new Map<string, { apiKey: string; registeredAt: number }>();
  private sequence = 0;

  /** Registers a provisioned key and returns its credential fingerprint. */
  register(apiKey: string): string {
    const credentialRef = credentialReference(apiKey);
    this.sequence += 1;
    this.entries.set(credentialRef, { apiKey, registeredAt: this.sequence });
    return credentialRef;
  }

  has(credentialRef: string): boolean {
    return this.entries.has(credentialRef);
  }

  keyForCredential(credentialRef: string): string | undefined {
    return this.entries.get(credentialRef)?.apiKey;
  }

  /** Most recently provisioned key; used by management commands and inline features. */
  activeApiKey(): string | undefined {
    let active: { apiKey: string; registeredAt: number } | undefined;
    for (const entry of this.entries.values()) {
      if (!active || entry.registeredAt >= active.registeredAt) active = entry;
    }
    return active?.apiKey;
  }
}
