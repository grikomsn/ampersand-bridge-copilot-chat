import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
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
import { NativeEntries, entryIdFromConfiguration, qualifiedModelId, type NativeEntry } from "./provider-profile";
import { isTransientNetworkError, isTransientServerError, retryDelayMs } from "./provider/retry";
import { messageToText } from "./provider/messages";
import { buildRequest } from "./provider/request";
import { StreamResponseReporter } from "./provider/response";
import { observeEntry, observedEntries } from "./provider-journal";
import { mergeAccountUsage, recordRequestUsage, type AmpersandUsageSnapshot } from "./usage/domain";
import { stringifyWellFormedJson } from "./transport/unicode";

export { API_BASE } from "./transport/protocol";

export interface AmpersandModel extends vscode.LanguageModelChatInformation, NativeEntry {
  rawModelId: string;
  /** The model's supported reasoning efforts; undefined when it has no reasoning control. */
  effortSpec?: ModelEffortSpec;
}

export class AmpersandProvider implements vscode.LanguageModelChatProvider<AmpersandModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly usageEmitter = new vscode.EventEmitter<AmpersandUsageSnapshot>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  /** Fires with the full usage snapshot whenever the balance or usage changes. */
  readonly onDidChangeUsage = this.usageEmitter.event;
  private readonly catalogs = new Map<string, AmpersandModelMetadata[]>();
  private readonly refreshedAt = new Map<string, number>();
  private readonly entries: NativeEntries;
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
    const forgotten = state?.get<unknown>("ampersandBridge.forgottenEntries.v1");
    this.entries = new NativeEntries(Array.isArray(forgotten) ? forgotten.filter((id): id is string => typeof id === "string") : []);
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
  getUsageSnapshot(entry = this.selectedEntry()): AmpersandUsageSnapshot {
    return this.usageByCredential.get(entry.credentialRef) ?? {};
  }

  getSelectedUsageSnapshot(): AmpersandUsageSnapshot {
    try { return this.getUsageSnapshot(); } catch { return {}; }
  }

  getEntries(): NativeEntry[] { return this.entries.list(); }
  getForgottenEntries(): string[] { return this.entries.forgottenIds(); }

  async restoreEntry(entryId: string): Promise<void> {
    this.entries.restore(entryId);
    await this.persistOwnedState();
    this.changeEmitter.fire();
  }

  getObservedEntries(): ReturnType<typeof observedEntries> {
    return this.state ? observedEntries(this.state) : {};
  }

  selectedEntry(): NativeEntry {
    return this.entries.get(this.configuration.get("managementEntry", ""));
  }

  getFeatureApiKey(setting: "inlineSuggestionsEntry"): string | undefined {
    const entryId = this.configuration.get<string>(setting, "");
    if (!entryId) return undefined;
    return this.entries.key(this.entries.get(entryId));
  }

  async forgetEntry(entryId: string): Promise<void> {
    const entry = this.entries.list().find((item) => item.entryId === entryId);
    this.entries.forget(entryId);
    if (entry) {
      this.usageByCredential.delete(entry.credentialRef);
      this.catalogs.delete(entry.credentialRef);
      this.refreshedAt.delete(entry.credentialRef);
      this.rejectedKeys.delete(entry.credentialRef);
    }
    await this.persistOwnedState();
    if (this.state) await observeEntry(this.state, entryId, undefined);
    this.changeEmitter.fire();
    this.usageEmitter.fire({});
  }

  /** Resets locally tracked usage (the credit balance is re-fetched on next refresh). */
  clearUsage(): void {
    this.setAndEmitUsage({}, this.selectedEntry());
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
  async refreshUsage(entry = this.selectedEntry()): Promise<AmpersandUsageSnapshot> {
    const apiKey = this.entries.key(entry);
    try {
      const response = await this.fetcher(AMPERSAND_ENDPOINTS.balance, {
        headers: this.requestHeaders(apiKey, "application/json"),
      });
      if (!response.ok) throw await apiError("Unable to load Ampersand Bridge credit balance", response);
      const next = mergeAccountUsage(this.getUsageSnapshot(entry), await response.json());
      this.setAndEmitUsage(next, entry);
      return next;
    } catch (error) {
      const message = messageOf(error);
      this.output.appendLine(`[usage] Ampersand Bridge balance refresh unavailable: ${message}`);
      if (this.entries.matches(entry)) {
        this.setAndEmitUsage({ ...this.getUsageSnapshot(entry), updatedAt: Date.now(), error: message }, entry);
      }
      throw error;
    }
  }

  async refreshModels(): Promise<string[]> {
    const entry = this.selectedEntry();
    const models = await this.refreshCatalog(entry, this.entries.key(entry));
    this.changeEmitter.fire();
    return models.map(({ id }) => id);
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<AmpersandModel[]> {
    if (token.isCancellationRequested || !options.configuration) return [];
    const entryId = entryIdFromConfiguration(options.configuration);
    if (this.entries.isForgotten(entryId)) return [];
    const previous = this.entries.list().find((item) => item.entryId === entryId);
    const entry = this.entries.register(options.configuration);
    const { entryId: registeredEntryId, credentialRef, generation } = entry;
    const apiKey = this.entries.key(entry);
    if (previous && previous.generation !== generation) {
      // A rotation retires the previous credential's catalog and usage scope.
      this.usageByCredential.delete(previous.credentialRef);
      this.catalogs.delete(previous.credentialRef);
      this.refreshedAt.delete(previous.credentialRef);
      this.rejectedKeys.delete(previous.credentialRef);
      await this.persistOwnedState();
    }
    const maxAge = Math.max(1, this.configuration.get("catalogCacheMinutes", 5)) * 60_000;
    if (Date.now() - (this.refreshedAt.get(credentialRef) ?? 0) > maxAge) {
      try {
        await this.refreshCatalog(entry, apiKey, token);
      } catch (error) {
        if (isRejectedKey(error)) {
          // A refused key would fail every request; retry after the cache
          // window rather than on every model-picker query.
          this.refreshedAt.set(credentialRef, Date.now());
          this.warnRejectedKey(registeredEntryId, error);
        } else if (!token.isCancellationRequested) {
          this.output.appendLine(`[models] discovery failed; using cached/fallback list: ${messageOf(error)}`);
        }
      }
    }

    if (token.isCancellationRequested || !this.entries.matches(entry)) return [];
    // Every request with a refused key would fail, so list nothing at all.
    if (this.rejectedKeys.has(credentialRef)) return [];
    if (this.state) await observeEntry(this.state, registeredEntryId, this.catalogFor(credentialRef).length);
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
        id: qualifiedModelId(registeredEntryId, metadata.id),
        rawModelId: metadata.id,
        credentialRef,
        entryId: registeredEntryId,
        generation,
        effortSpec,
        name: metadata.name || formatModelName(metadata.id),
        family: modelFamily(metadata.id),
        version: metadata.version,
        detail: `Ampersand Bridge · ${registeredEntryId}`,
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
    const apiKey = this.entries.key(model);
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
      (usage) => this.captureRequestUsage(usage, model.rawModelId, model));
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
      throw error;
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
    const text = typeof value === "string" ? value : messageToText(value);
    return Math.max(1, Math.ceil(text.length / 4));
  }

  async testConnection(): Promise<{
    model: string;
    reasoningEffort?: ReasoningEffort;
    text: string;
  }> {
    const entry = this.selectedEntry();
    const { credentialRef } = entry;
    const apiKey = this.entries.key(entry);
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
    if (responseBody.usage) this.captureRequestUsage(responseBody.usage, model, entry);
    return {
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      text: responseBody.choices?.[0]?.message?.content?.trim() ?? "(empty response)",
    };
  }

  /** Reasoning efforts a model accepts, from the active catalog with fallback metadata. */
  reasoningEffortsFor(modelId: string): readonly ReasoningEffort[] | undefined {
    const canonical = modelId.trim().toLowerCase();
    const live = this.catalogFor(this.selectedEntry().credentialRef).find((metadata) => metadata.id === canonical);
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
    entry: NativeEntry,
    apiKey: string,
    token?: vscode.CancellationToken,
  ): Promise<AmpersandModelMetadata[]> {
    if (token?.isCancellationRequested) return this.catalogFor(entry.credentialRef);
    const controller = new AbortController();
    const cancellation = token?.onCancellationRequested(() => controller.abort());
    try {
      const models = await this.fetchModels(apiKey, controller.signal);
      if (!token?.isCancellationRequested && this.entries.matches(entry)) this.setCatalog(entry.credentialRef, models);
      return models;
    } finally { cancellation?.dispose(); }
  }

  private warnRejectedKey(entryId: string, error: unknown): void {
    const entry = this.entries.list().find((item) => item.entryId === entryId);
    if (entry && this.rejectedKeys.has(entry.credentialRef)) return;
    if (entry) this.rejectedKeys.add(entry.credentialRef);
    this.output.appendLine(`[models] Ampersand Bridge rejected the API key; listing no models: ${messageOf(error)}`);
    void vscode.window.showWarningMessage(
      `Ampersand Bridge rejected the API key of the provider entry “${entryId}”. Update its key in Manage Language Models.`,
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
  private captureRequestUsage(raw: Record<string, unknown>, modelId: string, entry: NativeEntry): void {
    if (!this.entries.matches(entry)) return;
    const next = recordRequestUsage(this.getUsageSnapshot(entry), raw, modelId);
    if (this.debugLogging) this.output.appendLine(`[usage] model=${modelId} recorded`);
    this.setAndEmitUsage(next, entry);
  }

  private setAndEmitUsage(usage: AmpersandUsageSnapshot, entry: NativeEntry): void {
    if (!this.entries.matches(entry)) return;
    this.usageByCredential.set(entry.credentialRef, usage);
    void this.persistOwnedState();
    if (this.configuration.get("managementEntry", "") === entry.entryId) this.usageEmitter.fire(usage);
  }

  private persistOwnedState(): Promise<void> {
    this.stateMutation = this.stateMutation.catch(() => undefined).then(async () => {
      if (!this.state) return;
      await this.state.update("ampersandBridge.forgottenEntries.v1", this.entries.forgottenIds());
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
