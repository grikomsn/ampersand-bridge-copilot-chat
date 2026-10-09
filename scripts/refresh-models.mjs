#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const fields = ["contextLength", "maxOutputTokens", "imageInput", "toolCalling", "reasoningEfforts", "defaultReasoningEffort", "cost"];

/** Compare normalized public metadata without writing source files or opening a PR. */
export function compareCatalogs(bundled, live) {
  const baseline = new Map(bundled.map((model) => [model.id, model]));
  const discovered = new Map(live.map((model) => [model.id, model]));
  return {
    added: live.filter((model) => !baseline.has(model.id)).map((model) => model.id).sort(),
    absent: bundled.filter((model) => !discovered.has(model.id)).map((model) => model.id).sort(),
    changes: live.flatMap((model) => {
      const previous = baseline.get(model.id);
      return previous ? fields.flatMap((field) => isDeepStrictEqual(previous[field], model[field])
        ? [] : [{ id: model.id, field, before: previous[field], after: model[field] }]) : [];
    }),
  };
}

function cell(value) {
  return String(value === undefined ? "omitted" : typeof value === "string" ? value : JSON.stringify(value))
    .replace(/[\r\n]/g, " ").replace(/\|/g, "\\|").replace(/`/g, "'");
}

export function formatReport(comparison, source, date) {
  const rows = comparison.changes.map(({ id, field, before, after }) =>
    `| ${cell(id)} | ${cell(field)} | ${cell(before)} | ${cell(after)} |`);
  return [
    `# Ampersand Bridge model metadata comparison — ${date}`,
    "",
    `Source: ${source}. Public USD metadata only; account-specific availability and pricing may differ.`,
    "New or absent IDs require maintainer review; this command never edits source or creates a PR.",
    "",
    `New IDs: ${comparison.added.map(cell).join(", ") || "none"}`,
    `Bundled IDs absent from the public catalog: ${comparison.absent.map(cell).join(", ") || "none"}`,
    "",
    ...(rows.length ? ["| Model | Field | Bundled | Public |", "| --- | --- | --- | --- |", ...rows]
      : ["No field drift detected among shared models."]),
    "",
  ].join("\n");
}

export async function fetchCatalog(fetchImpl = fetch) {
  const { AMPERSAND_ENDPOINTS, extensionUserAgent } = require("../out/transport/protocol.js");
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const response = await fetchImpl(AMPERSAND_ENDPOINTS.models, {
    headers: { accept: "application/json", "User-Agent": extensionUserAgent(manifest.version, manifest.engines.vscode.replace(/^\^/, "")) },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Public Ampersand Bridge catalog request failed (HTTP ${response.status})`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.data) || payload.data.some((model) => !model || typeof model.id !== "string")) {
    throw new Error("Public Ampersand Bridge catalog has an invalid shape");
  }
  if (payload.data.some((model) => model.currency !== undefined && model.currency !== "usd")) {
    throw new Error("Public Ampersand Bridge catalog did not return USD pricing");
  }
  // A drift report must not silently substitute bundled values for missing live fields.
  if (payload.data.some((model) => !Number.isSafeInteger(model.context_window) || model.context_window <= 0
    || !Number.isSafeInteger(model.max_output_tokens) || model.max_output_tokens <= 0
    || !Array.isArray(model.capabilities) || model.capabilities.some((capability) => typeof capability !== "string")
    || !Array.isArray(model.reasoning_efforts) || model.reasoning_efforts.some((effort) => typeof effort !== "string")
    || (model.reasoning_efforts.length
      ? !model.reasoning_efforts.includes(model.reasoning_effort_default)
      : model.reasoning_effort_default !== undefined && model.reasoning_effort_default !== null)
    || [model.input_per_1m, model.output_per_1m].some((rate) => rate === undefined || rate === null || rate === ""
      || !Number.isFinite(Number(rate)) || Number(rate) < 0))) {
    throw new Error("Public Ampersand Bridge metadata is incomplete; review its schema before comparing the snapshot");
  }
  return payload;
}

/** Formats a number literal with thousands separators, matching the bundled style. */
function numericLiteral(value) {
  const text = String(value);
  return text.length >= 6 ? text.replace(/\B(?=(\d{3})+(?!\d))/g, "_") : text;
}

/** Serializes one FALLBACK_MODEL_METADATA row; trailing-false flags are trimmed. */
function metadataRow(model) {
  return `  model(${JSON.stringify(model.id)}, ${numericLiteral(model.contextLength)}, ${numericLiteral(model.maxOutputTokens)}${model.imageInput ? ", true" : ""}),`;
}

/** Serializes one FALLBACK_REASONING_EFFORTS entry, or undefined when the model has no effort list. */
function effortsEntry(model) {
  if (!model.reasoningEfforts?.length) return undefined;
  const defaultEffort = model.defaultReasoningEffort ?? model.reasoningEfforts.at(-1);
  return `  ${JSON.stringify(model.id)}: { efforts: [${model.reasoningEfforts.map((effort) => JSON.stringify(effort)).join(", ")}], defaultEffort: ${JSON.stringify(defaultEffort)} },`;
}

/** Serializes one OFFICIAL_MODEL_COSTS row, or undefined when live pricing is absent. */
function costEntry(model) {
  if (!model.cost) return undefined;
  return `  ${JSON.stringify(model.id)}: { input: ${model.cost.input}, cacheRead: ${model.cost.cacheRead}, output: ${model.cost.output} },`;
}

/** Replaces a delimited source region between a start and end marker. */
function editRegion(source, startMarker, endMarker, next) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Bundled metadata region not found; review the source layout");
  return source.slice(0, start) + next + source.slice(end);
}

/** Rewrites bundled fallback regions from live metadata; only listed bundled IDs change. */
export function applyCatalog(sourceCatalog, sourcePricing, bundledIds, live) {
  const listed = new Set(bundledIds);
  const models = live.filter((model) => listed.has(model.id));
  const efforts = models.map(effortsEntry).filter((entry) => entry !== undefined).join("\n");
  const metadata = models.map(metadataRow).join("\n");
  const costs = models.map(costEntry).filter((entry) => entry !== undefined).join("\n");
  const nextCatalog = editRegion(
    editRegion(sourceCatalog,
      "const FALLBACK_REASONING_EFFORTS: Readonly<Record<string, {\n  readonly efforts: readonly ReasoningEffort[];\n  readonly defaultEffort: ReasoningEffort;\n}>> = {",
      "\n};",
      `${efforts}\n`),
    "export const FALLBACK_MODEL_METADATA: readonly AmpersandModelMetadata[] = [",
    "\n];",
    `${metadata}\n`);
  const nextPricing = editRegion(sourcePricing,
    "const OFFICIAL_MODEL_COSTS: Readonly<Record<string, ModelCost>> = {",
    "\n};",
    `${costs}\n`);
  return { catalog: nextCatalog, pricing: nextPricing };
}

const CHANGESET_SUMMARY = "Resync bundled model metadata with the live hosted catalog (contexts, output limits, image input, reasoning efforts, and USD pricing).";

function writeChangeset(date) {
  writeFileSync(path.join(root, ".changeset", `resync-model-metadata-${date}.md`),
    `---\n"ampersand-bridge-copilot-chat": patch\n---\n\n${CHANGESET_SUMMARY}\n`);
}

/** Applies live metadata to the bundled regions and writes the companion changeset. */
export function applyToSourceTree(live, date) {
  const catalogPath = path.join(root, "src/models/catalog.ts");
  const pricingPath = path.join(root, "src/models/pricing.ts");
  const { FALLBACK_MODELS } = require("../out/models/catalog.js");
  const result = applyCatalog(readFileSync(catalogPath, "utf8"), readFileSync(pricingPath, "utf8"), FALLBACK_MODELS, live);
  writeFileSync(catalogPath, result.catalog);
  writeFileSync(pricingPath, result.pricing);
  writeChangeset(date);
  return result;
}

export async function main(args = process.argv.slice(2)) {
  let reportFile;
  let check = false;
  let apply = false;
  let pullRequest = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--check") check = true;
    else if (args[index] === "--apply" || args[index] === "--ci") apply = true;
    else if (args[index] === "--pr") { apply = true; pullRequest = true; }
    else if (args[index] === "--report-file" && args[index + 1] && !args[index + 1].startsWith("--")) reportFile = args[++index];
    else throw new Error("Usage: npm run refresh-models -- [--check] [--apply] [--pr] [--report-file path]");
  }
  const date = new Date().toISOString().slice(0, 10);
  const { FALLBACK_MODEL_METADATA, FALLBACK_MODELS, modelCatalogFromApi } = require("../out/models/catalog.js");
  const { AMPERSAND_ENDPOINTS } = require("../out/transport/protocol.js");
  const live = modelCatalogFromApi(await fetchCatalog());
  const comparison = compareCatalogs(FALLBACK_MODEL_METADATA, live);
  let report = formatReport(comparison, AMPERSAND_ENDPOINTS.models, date);
  if (apply && (comparison.changes.length)) {
    applyToSourceTree(live, date);
    report += "Applied bundled metadata changes for the drifted fields above; new and absent IDs still require maintainer review.\n";
  } else if (apply) {
    report += "No bundled metadata changes to apply.\n";
  }
  if (reportFile) writeFileSync(reportFile, report);
  process.stdout.write(report);
  if (pullRequest) {
    if (process.env.AMPERSAND_API_KEY === undefined && process.env.CI) {
      throw new Error("--pr requires AMPERSAND_API_KEY for an authenticated push context");
    }
    const branch = `resync/model-metadata-${date}`;
    const { execFileSync } = await import("node:child_process");
    const git = (gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" });
    git(["switch", "--create", branch]);
    git(["add", "src/", ".changeset/"]);
    git(["commit", "-m", "Resync model metadata"]);
    git(["push", "-u", "origin", branch]);
    execFileSync("gh", ["pr", "create", "--fill", "--body-file", reportFile ?? "/dev/stdin"], { cwd: root, stdio: "inherit" });
    git(["switch", "main"]);
  }
  if (check && (comparison.changes.length || comparison.added.length || comparison.absent.length)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Model comparison failed");
    process.exitCode = 1;
  });
}
