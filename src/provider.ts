import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { estimateChatTokens } from "./provider/token-count";
import { withContextOverflowHint } from "./provider/context-error";
import { messageOf } from "./errors";
import {
  advertisedModelLimits,
  FALLBACK_MODEL_METADATA,
  FALLBACK_MODELS,
  formatTokenLimit,
  formatModelName,
  modelCatalogFromApi,
  type AmpersandModelMetadata,
} from "./models/catalog";
import { modelPricingFields } from "./models/pricing";
import {
  DEFAULT_REASONING_EFFORT,
  applyReasoningEffort,
  buildModelConfigurationSchema,
  contextSizeOptions,
  modelEffortSpec,
  resolveContextCap,
  resolveContextSize,
  resolveReasoningEffort,
  type ModelEffortSpec,
  type ReasoningEffort,
} from "./models/options";
import { parseCatalogSnapshots } from "./models/cache";
import { ModelsDevMetadata } from "./models/metadata";
import { ChatCompletionStreamParser } from "./transport/sse";
import { AMPERSAND_ENDPOINTS, ampersandHeaders } from "./transport/protocol";
import { apiError, isRejectedKey } from "./transport/errors";
import { modelFamily } from "./models/family";
import { apiKeyFromConfiguration, Credentials } from "./provider-profile";
import { credentialReference } from "./auth/auth";
import { isTransientNetworkError, isTransientServerError, retryDelayMs } from "./provider/retry";
import { messageToText } from "./provider/messages";
import { buildRequest } from "./provider/request";
import { StreamResponseReporter } from "./provider/response";
import { mergeAccountUsage, recordRequestUsage, type AmpersandUsageSnapshot } from "./usage/domain";
import { stringifyWellFormedJson } from "./transport/unicode";

export { API_BASE } from "./transport/protocol";

export interface AmpersandModel extends vscode.LanguageModelChatInformation {
  rawModelId: string;
  /** The model's supported reasoning efforts; undefined when it has no reasoning control. */
  effortSpec?: ModelEffortSpec;
  /** Fingerprint of the provisioned API key that serves this model. */
  credentialRef: string;
}

export class AmpersandProvider implements vscode.LanguageModelChatProvider<AmpersandModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<AmpersandUsageSnapshot>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  /** Fires with the full usage snapshot whenever the balance or usage changes. */
  readonly onDidChangeUsage = this.usageEmitter.event;
  private readonly catalogs = new Map<string, AmpersandModelMetadata[]>();
  private readonly refreshedAt = new Map<string, number>();
  private readonly credentials = new Credentials();
  /** Credential refs whose key the service refused; they list no models. */
  private readonly rejectedKeys = new Set<string>();
  private readonly usageByCredential = new Map<string, AmpersandUsageSnapshot>();
  private readonly metadata: ModelsDevMetadata;
  private stateMutation: Promise<void> = Promise.resolve();

  private get configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("ampersandBridge");
  }

  private get debugLogging(): boolean {
    return this.configuration.get("debugLogging", false);
  }

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly userAgent: string,
    private readonly state?: vscode.Memento,
    initialUsage: Readonly<Record<string, AmpersandUsageSnapshot>> = {},
    private readonly fetcher: typeof fetch = fetch,
  ) {
    // Only inference activity is persisted; the credit balance is refreshed live.
    for (const [ref, usage] of Object.entries(initialUsage)) this.usageByCredential.set(ref, usage);
    this.metadata = new ModelsDevMetadata(state ?? new MemoryMetadataCache(), this.fetcher);
    for (const [key, catalog] of Object.entries(parseCatalogSnapshots(state?.get<unknown>(CATALOG_STATE_KEY))))
      this.catalogs.set(key, catalog);
  }

  fireDidChange(): void {
    this.changeEmitter.fire();
    this.usageEmitter.fire(this.getSelectedUsageSnapshot());
  }

  /** Returns the current usage snapshot without side effects. @see {@link refreshUsage} */
  getUsageSnapshot(credentialRef = this.activeCredentialRef() ?? ""): AmpersandUsageSnapshot {
    return this.usageByCredential.get(credentialRef) ?? {};
  }

  getSelectedUsageSnapshot(): AmpersandUsageSnapshot {
    return this.getUsageSnapshot();
  }

  getFeatureApiKey(): string | undefined {
    return this.credentials.activeApiKey();
  }

  /** Prunes catalogs whose key is no longer provisioned by any native entry. */
  private pruneCatalogs(): void {
    for (const reference of this.catalogs.keys()) {
      if (this.credentials.keyForCredential(reference)) continue;
      this.catalogs.delete(reference);
      this.refreshedAt.delete(reference);
      this.rejectedKeys.delete(reference);
    }
  }

  private activeCredentialRef(): string | undefined {
    const apiKey = this.getFeatureApiKey();
    return apiKey ? credentialReference(apiKey) : undefined;
  }

  /** Resets locally tracked usage (the credit balance is re-fetched on next refresh). */
  clearUsage(): void {
    const credentialRef = this.activeCredentialRef();
    if (!credentialRef) return;
    this.setAndEmitUsage({}, credentialRef);
  }

  /**
   * Refreshes the credit balance and daily request allowance from the account
   * endpoint, then returns the updated snapshot.
   *
   * The failure is captured in the snapshot as `error` (the status bar keeps
   * showing the last known balance), and the error is rethrown for callers
   * that surface it directly.
   *
   * @example
   * await provider.refreshUsage();
   * provider.getUsageSnapshot().account?.credits; // e.g. 12.5
   *
   * @see {@link getUsageSnapshot}, {@link onDidChangeUsage}
   */
  async refreshUsage(credentialRef = this.activeCredentialRef() ?? ""): Promise<AmpersandUsageSnapshot> {
    const apiKey = this.credentials.keyForCredential(credentialRef);
    if (!apiKey) throw new Error("Provision an Ampersand Bridge entry in Manage Language Models first.");
    try {
      const response = await this.fetcher(AMPERSAND_ENDPOINTS.balance, {
        headers: this.requestHeaders(apiKey, "application/json"),
      });
      if (!response.ok) throw await apiError("Unable to load Ampersand Bridge credit balance", response);
      const next = mergeAccountUsage(this.getUsageSnapshot(credentialRef), await response.json());
      this.setAndEmitUsage(next, credentialRef);
      return next;
    } catch (error) {
      const message = messageOf(error);
      this.output.appendLine(`[usage] Ampersand Bridge balance refresh unavailable: ${message}`);
      if (this.credentials.has(credentialRef)) {
        this.setAndEmitUsage({ ...this.getUsageSnapshot(credentialRef), updatedAt: Date.now(), error: message }, credentialRef);
      }
      throw error;
    }
  }

  async refreshModels(): Promise<string[]> {
    const apiKey = this.getFeatureApiKey();
    if (!apiKey) throw new Error("Provision an Ampersand Bridge entry in Manage Language Models first.");
    const models = await this.refreshCatalog(credentialReference(apiKey), apiKey);
    this.changeEmitter.fire();
    return models.map(({ id }) => id);
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<AmpersandModel[]> {
    if (token.isCancellationRequested || !options.configuration) return [];
    let apiKey: string | undefined;
    try {
      apiKey = apiKeyFromConfiguration(options.configuration);
      if (!apiKey) throw new Error("Set a valid Ampersand Bridge API key in Manage Language Models");
    } catch (error) {
      const message = messageOf(error);
      this.output.appendLine(`[models] ${message}`);
      if (!options.silent) void vscode.window.showErrorMessage(message);
      return [];
    }
    const credentialRef = this.credentials.register(apiKey);
    this.pruneCatalogs();
    const maxAge = Math.max(1, this.configuration.get("catalogCacheMinutes", 5)) * 60_000;
    if (Date.now() - (this.refreshedAt.get(credentialRef) ?? 0) > maxAge) {
      try {
        await this.refreshCatalog(credentialRef, apiKey, token);
      } catch (error) {
        if (isRejectedKey(error)) {
          // A refused key would fail every request; retry after the cache
          // window rather than on every model-picker query.
          this.refreshedAt.set(credentialRef, Date.now());
          this.warnRejectedKey(credentialRef, error);
        } else if (!token.isCancellationRequested) {
          this.output.appendLine(`[models] discovery failed; using cached/fallback list: ${messageOf(error)}`);
        }
      }
    }

    if (token.isCancellationRequested || !this.credentials.has(credentialRef)) return [];
    // Every request with a refused key would fail, so list nothing at all.
    if (this.rejectedKeys.has(credentialRef)) return [];
    this.usageEmitter.fire(this.getSelectedUsageSnapshot());
    const workspaceDefault = this.configuration.get("reasoningEffort", DEFAULT_REASONING_EFFORT);
    return this.catalogFor(credentialRef).map((metadata) => {
      const pricing = modelPricingFields(metadata.cost);
      const limits = advertisedModelLimits(metadata, this.configuration.get("maxOutputTokens", 0));
      const effortSpec = modelEffortSpec(metadata.reasoningEfforts, metadata.defaultReasoningEffort);
      // The picker's default selection prefers the workspace default when the
      // model supports it, else the model's own default.
      const pickerDefault = effortSpec && (effortSpec.efforts as readonly string[]).includes(workspaceDefault)
        ? workspaceDefault as ReasoningEffort
        : effortSpec?.defaultEffort;
      const pickerSpec = effortSpec && pickerDefault
        ? { efforts: effortSpec.efforts, defaultEffort: pickerDefault }
        : undefined;
      const contextOptions = contextSizeOptions(limits.maxInputTokens);
      const configurationSchema = pickerSpec || contextOptions
        ? buildModelConfigurationSchema(pickerSpec, contextOptions)
        : undefined;
      return {
        id: metadata.id,
        rawModelId: metadata.id,
        credentialRef,
        effortSpec,
        name: metadata.name || formatModelName(metadata.id),
        family: modelFamily(metadata.id),
        version: metadata.version,
        detail: "Ampersand Bridge",
        tooltip: `${metadata.id} via Ampersand Bridge · ${formatTokenLimit(metadata.contextLength)} context · ${formatTokenLimit(
          metadata.maxOutputTokens,
        )} max output${metadata.imageInput ? " · image input" : " · text input"}${
          metadata.releaseDate ? ` · released ${metadata.releaseDate}` : ""
        }${pricing ? ` · ${pricing.pricing}` : ""}${metadata.description ? `\n${metadata.description}` : ""}`,
        ...limits,
        isUserSelectable: true,
        isBYOK: true,
        ...(configurationSchema ? { configurationSchema } : {}),
        capabilities: {
          imageInput: metadata.imageInput,
          toolCalling: metadata.toolCalling,
        },
        ...(pricing ?? {}),
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: AmpersandModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (token.isCancellationRequested) return;
    const apiKey = this.credentials.keyForCredential(model.credentialRef);
    if (!apiKey) {
      throw new Error("This entry's API key was replaced or removed. Reselect its model in Manage Language Models.");
    }
    const reasoningEffort = resolveReasoningEffort(
      model.effortSpec,
      options.modelConfiguration,
      this.configuration.get("reasoningEffort", DEFAULT_REASONING_EFFORT),
    );
    const requestBody = buildRequest(
      model.rawModelId,
      messages,
      options,
      reasoningEffort,
      model.maxOutputTokens,
      this.configuration.get("maxOutputTokens", 0),
      Boolean(model.capabilities?.imageInput),
      resolveContextCap(resolveContextSize(options.modelConfiguration), model.maxInputTokens),
    );
    const reporter = new StreamResponseReporter(progress, vscode, randomUUID(),
      (usage) => this.captureRequestUsage(usage, model.rawModelId, model.credentialRef));
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    const timeoutSeconds = Math.max(10, this.configuration.get("requestTimeoutSeconds", 600));
    const idleTimeoutSeconds = Math.max(10, this.configuration.get("streamIdleTimeoutSeconds", 120));
    let timedOut: "total" | "idle" | undefined;
    const totalTimeout = setTimeout(() => {
      timedOut = "total";
      controller.abort();
    }, timeoutSeconds * 1000);
    let idleTimeout: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimeout = (): void => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        timedOut = "idle";
        controller.abort();
      }, idleTimeoutSeconds * 1000);
    };
    resetIdleTimeout();
    try {
      if (this.debugLogging) {
        this.output.appendLine(
          `[request] model=${model.rawModelId} effort=${reasoningEffort} initiator=${
            options.requestInitiator ?? "unknown"
          }`,
        );
      }
      const response = await this.fetchInference({
        method: "POST",
        headers: this.requestHeaders(apiKey, "text/event-stream"),
        body: stringifyWellFormedJson(requestBody),
        signal: controller.signal,
      });
      if (!response.ok) throw await apiError(`Ampersand Bridge request failed for ${model.rawModelId}`, response);
      if (!response.body) throw new Error("Ampersand Bridge returned an empty response stream");

      const parser = new ChatCompletionStreamParser();
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        if (token.isCancellationRequested) {
          await reader.cancel();
          return;
        }
        const result = await reader.read();
        if (result.done) break;
        resetIdleTimeout();
        for (const event of parser.push(decoder.decode(result.value, { stream: true }))) {
          // The final streamed chunk carries the `usage` object; capture it
          // when present so the status bar reflects the request immediately.
          reporter.report(event);
        }
      }
      for (const event of parser.push(decoder.decode())) reporter.report(event);
      for (const event of parser.finish()) reporter.report(event);
      parser.validateCompletion(requestBody.tool_choice === "required");
    } catch (error) {
      if (token.isCancellationRequested) return;
      if (timedOut === "idle")
        throw new Error(`Ampersand Bridge request for ${model.rawModelId} received no data for ${idleTimeoutSeconds} seconds`);
      if (timedOut === "total")
        throw new Error(`Ampersand Bridge request for ${model.rawModelId} exceeded ${timeoutSeconds} seconds`);
      throw withContextOverflowHint(error);
    } finally {
      reporter.finish();
      controller.abort();
      if (reader) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      clearTimeout(totalTimeout);
      if (idleTimeout) clearTimeout(idleTimeout);
      cancellation.dispose();
    }
  }

  async provideTokenCount(
    _model: AmpersandModel,
    value: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return estimateChatTokens(value);
  }

  async testConnection(): Promise<{
    model: string;
    reasoningEffort?: ReasoningEffort;
    text: string;
  }> {
    const apiKey = this.getFeatureApiKey();
    if (!apiKey) throw new Error("Provision an Ampersand Bridge entry in Manage Language Models first.");
    const credentialRef = credentialReference(apiKey);
    const models = this.catalogFor(credentialRef);
    const model = models[0]?.id ?? FALLBACK_MODELS[0];
    const effortSpec = modelEffortSpec(models[0]?.reasoningEfforts, models[0]?.defaultReasoningEffort);
    const reasoningEffort = resolveReasoningEffort(
      effortSpec,
      undefined,
      this.configuration.get("reasoningEffort", DEFAULT_REASONING_EFFORT),
    );
    const requestBody = {
      model,
      messages: [
        {
          role: "user",
          content: "Reply with exactly: Ampersand Bridge connection verified",
        },
      ],
      max_completion_tokens: 512,
      stream: false,
    };
    const response = await this.fetcher(AMPERSAND_ENDPOINTS.chat, {
      method: "POST",
      headers: this.requestHeaders(apiKey, "application/json"),
      body: JSON.stringify(applyReasoningEffort(requestBody, reasoningEffort)),
    });
    if (!response.ok) throw await apiError("Ampersand Bridge connection test failed", response);
    const responseBody = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Record<string, unknown>;
    };
    if (responseBody.usage) this.captureRequestUsage(responseBody.usage, model, credentialRef);
    return {
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      text: responseBody.choices?.[0]?.message?.content?.trim() ?? "(empty response)",
    };
  }

  /** Reasoning efforts a model accepts, from the active catalog with fallback metadata. */
  reasoningEffortsFor(modelId: string): readonly ReasoningEffort[] | undefined {
    const canonical = modelId.trim().toLowerCase();
    const credentialRef = this.activeCredentialRef();
    if (!credentialRef) return undefined;
    const live = this.catalogFor(credentialRef).find((metadata) => metadata.id === canonical);
    return live?.reasoningEfforts;
  }

  private async fetchModels(apiKey: string, signal?: AbortSignal): Promise<AmpersandModelMetadata[]> {
    if (!apiKey) throw new Error("Ampersand Bridge API key is not configured");
    const response = await this.fetcher(AMPERSAND_ENDPOINTS.models, {
      headers: this.requestHeaders(apiKey, "application/json, application/problem+json"),
      signal,
    });
    if (!response.ok) throw await apiError("Unable to list Ampersand Bridge models", response);
    const body: unknown = await response.json();
    const enrichment = await this.metadata.getOrRefresh();
    const models = modelCatalogFromApi(body, enrichment.models);
    if (this.debugLogging) this.output.appendLine(`[models] ${models.map(({ id }) => id).join(", ")}`);
    return models;
  }

  private catalogFor(credentialRef: string): AmpersandModelMetadata[] {
    let catalog = this.catalogs.get(credentialRef);
    if (!catalog) {
      catalog = [...FALLBACK_MODEL_METADATA];
      this.catalogs.set(credentialRef, catalog);
    }
    return catalog;
  }

  private setCatalog(credentialRef: string, models: readonly AmpersandModelMetadata[]): void {
    this.catalogs.set(credentialRef, [...models]);
    this.refreshedAt.set(credentialRef, Date.now());
    this.rejectedKeys.delete(credentialRef);
    void this.persistOwnedState();
  }

  private async refreshCatalog(
    credentialRef: string,
    apiKey: string,
    token?: vscode.CancellationToken,
  ): Promise<AmpersandModelMetadata[]> {
    if (token?.isCancellationRequested) return this.catalogFor(credentialRef);
    const controller = new AbortController();
    const cancellation = token?.onCancellationRequested(() => controller.abort());
    try {
      const models = await this.fetchModels(apiKey, controller.signal);
      if (!token?.isCancellationRequested && this.credentials.has(credentialRef)) this.setCatalog(credentialRef, models);
      return models;
    } finally { cancellation?.dispose(); }
  }

  private warnRejectedKey(credentialRef: string, error: unknown): void {
    if (this.rejectedKeys.has(credentialRef)) return;
    this.rejectedKeys.add(credentialRef);
    this.output.appendLine(`[models] Ampersand Bridge rejected the API key; listing no models: ${messageOf(error)}`);
    void vscode.window.showWarningMessage(
      "Ampersand Bridge rejected this entry's API key. Update its key in Manage Language Models.",
    );
  }

  private requestHeaders(apiKey: string, accept: string): Record<string, string> {
    return ampersandHeaders(apiKey, accept, this.userAgent);
  }

  private async fetchInference(init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.fetcher(AMPERSAND_ENDPOINTS.chat, init);
        if (attempt >= 2 || !isTransientServerError(response.status)) return response;
        const delay = retryDelayMs(attempt, response.headers.get("retry-after"));
        this.output.appendLine(`[retry] transient HTTP ${response.status}; attempt=${attempt + 2} delayMs=${delay}`);
        await response.body?.cancel().catch(() => undefined);
        await waitForRetry(delay, init.signal);
      } catch (error) {
        if (attempt >= 2 || !isTransientNetworkError(error)) throw error;
        const delay = retryDelayMs(attempt);
        this.output.appendLine(`[retry] transient network failure; attempt=${attempt + 2} delayMs=${delay}`);
        await waitForRetry(delay, init.signal);
      }
    }
  }

  /**
   * Records one inference request's usage into the snapshot and emits it.
   *
   * @see {@link recordRequestUsage}, {@link setAndEmitUsage}
   */
  private captureRequestUsage(raw: Record<string, unknown>, modelId: string, credentialRef: string): void {
    if (!this.credentials.has(credentialRef)) return;
    const next = recordRequestUsage(this.getUsageSnapshot(credentialRef), raw, modelId);
    if (this.debugLogging) this.output.appendLine(`[usage] model=${modelId} recorded`);
    this.setAndEmitUsage(next, credentialRef);
  }

  private setAndEmitUsage(usage: AmpersandUsageSnapshot, credentialRef: string): void {
    if (!this.credentials.has(credentialRef)) return;
    this.usageByCredential.set(credentialRef, usage);
    void this.persistOwnedState();
    if (credentialRef === this.activeCredentialRef()) this.usageEmitter.fire(usage);
  }

  private persistOwnedState(): Promise<void> {
    this.stateMutation = this.stateMutation.catch(() => undefined).then(async () => {
      if (!this.state) return;
      await this.state.update(CATALOG_STATE_KEY, Object.fromEntries(this.catalogs));
      const activity = Object.fromEntries([...this.usageByCredential].map(([ref, snapshot]) => [ref, {
        tracked: snapshot.tracked, lastRequest: snapshot.lastRequest,
      }]));
      await this.state.update(USAGE_STATE_KEY, activity);
    }).catch(() => { this.output.appendLine("[state] unable to persist entry cache"); });
    return this.stateMutation;
  }
}

const CATALOG_STATE_KEY = "ampersandBridge.entryCatalogs.v1";
const USAGE_STATE_KEY = "ampersandBridge.entryUsage.v1";

class MemoryMetadataCache {
  get<T>(_key: string): T | undefined {
    return undefined;
  }
  async update(_key: string, _value: unknown): Promise<void> {}
}

async function waitForRetry(milliseconds: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
