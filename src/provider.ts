import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { ChatCompletionStreamParser } from "./kit/chat-completions";
import { contextSizeOptions, resolveContextCap, resolveContextSize } from "./kit/context-size";
import { apiKeyFromConfiguration, credentialReference, Credentials } from "./kit/credentials";
import { httpError, isRejectedCredential, messageOf, withContextOverflowHint } from "./kit/errors";
import { modelPricingFields } from "./kit/pricing";
import { ephemeralSnapshotStore } from "./kit/remote-snapshot";
import { ChatEventReporter, ResponseWriter } from "./kit/response-writer";
import { fetchWithRetry, gatewayOrRateLimitStatuses } from "./kit/retry";
import { readTextStream, RequestDeadline } from "./kit/stream";
import { estimateChatTokens } from "./kit/token-count";
import { stringifyWellFormedJson } from "./kit/unicode";
import {
  advertisedModelLimits,
  FALLBACK_MODEL_METADATA,
  FALLBACK_MODELS,
  formatTokenLimit,
  formatModelName,
  modelCatalogFromApi,
  type AmpersandModelMetadata,
} from "./models/catalog";
import {
  DEFAULT_REASONING_EFFORT,
  applyReasoningEffort,
  buildModelConfigurationSchema,
  modelEffortSpec,
  resolveReasoningEffort,
  type ModelEffortSpec,
  type ReasoningEffort,
} from "./models/options";
import { parseCatalogSnapshots } from "./models/cache";
import { ModelsDevMetadata } from "./models/metadata";
import { AMPERSAND_ENDPOINTS, ampersandHeaders } from "./transport/protocol";
import { modelFamily } from "./models/family";
import { buildRequest } from "./provider/request";
import { mergeAccountUsage, recordRequestUsage, toProviderUsagePayload, type AmpersandUsageSnapshot } from "./usage/domain";

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
    this.metadata = new ModelsDevMetadata(state ?? ephemeralSnapshotStore(), this.fetcher);
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
      if (!response.ok) throw await httpError("Unable to load Ampersand Bridge credit balance", response);
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
        if (isRejectedCredential(error)) {
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
    const reporter = new ChatEventReporter(new ResponseWriter(progress, vscode, "ampersand", randomUUID()), {
      label: "Ampersand Bridge",
      toUsagePayload: toProviderUsagePayload,
      onUsage: (usage) => this.captureRequestUsage(usage, model.rawModelId, model.credentialRef),
    });
    const timeoutSeconds = Math.max(10, this.configuration.get("requestTimeoutSeconds", 600));
    const idleTimeoutSeconds = Math.max(10, this.configuration.get("streamIdleTimeoutSeconds", 120));
    const deadline = new RequestDeadline({ totalMs: timeoutSeconds * 1000, idleMs: idleTimeoutSeconds * 1000, cancellation: token });
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
        signal: deadline.signal,
      });
      if (!response.ok) throw await httpError(`Ampersand Bridge request failed for ${model.rawModelId}`, response);
      if (!response.body) throw new Error("Ampersand Bridge returned an empty response stream");

      const parser = new ChatCompletionStreamParser({ label: "Ampersand Bridge" });
      const completed = await readTextStream(response.body, (text) => {
        // The final streamed chunk carries `usage`; the reporter captures it
        // so the status bar reflects the request immediately.
        for (const event of parser.push(text)) reporter.report(event);
      }, { deadline, isCancelled: () => token.isCancellationRequested });
      if (!completed) return;
      for (const event of parser.finish()) reporter.report(event);
      parser.validateCompletion(requestBody.tool_choice === "required");
    } catch (error) {
      if (token.isCancellationRequested) return;
      throw deadline.timeoutError(`Ampersand Bridge request for ${model.rawModelId}`) ?? withContextOverflowHint(error);
    } finally {
      reporter.finish();
      deadline.dispose();
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
    if (!response.ok) throw await httpError("Ampersand Bridge connection test failed", response);
    const responseBody = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Record<string, unknown>;
    };
    // Non-stream responses still carry a usage block; keep tracked usage current.
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
    if (!response.ok) throw await httpError("Unable to list Ampersand Bridge models", response);
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

  private fetchInference(init: RequestInit): Promise<Response> {
    return fetchWithRetry(() => this.fetcher(AMPERSAND_ENDPOINTS.chat, init), {
      isTransientStatus: gatewayOrRateLimitStatuses,
      signal: init.signal,
      log: (message) => this.output.appendLine(message),
    });
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


