import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

interface Manifest {
  name: string;
  displayName: string;
  publisher: string;
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string }>;
    languageModelChatProviders: Array<Record<string, unknown>>;
    languageModelTools?: unknown[];
  };
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync("package.json", "utf8")) as Manifest;
}

test("declares native API-key configuration without a management-command override", () => {
  const manifest = readManifest();
  const provider = manifest.contributes.languageModelChatProviders.find((item) => item.vendor === "ampersand-bridge");
  assert.ok(provider);
  assert.equal(provider.managementCommand, undefined);
  const configuration = provider.configuration as {
    required?: string[];
    properties?: Record<string, { secret?: boolean }>;
  };
  assert.deepEqual(configuration.required, ["entryId", "apiKey"]);
  assert.equal(configuration.properties?.apiKey.secret, true);
});

test("declares the rebranded extension identity and activation event", () => {
  const manifest = readManifest();
  assert.equal(manifest.name, "ampersand-bridge-copilot-chat");
  assert.equal(manifest.publisher, "grikomsn");
  assert.match(manifest.displayName, /Ampersand Bridge/);
  assert.ok(manifest.activationEvents.includes("onLanguageModelChatProvider:ampersand-bridge"));
  assert.ok(!JSON.stringify(manifest).includes("aiand"));
  assert.ok(!JSON.stringify(manifest).includes("ai&"));
});

test("keeps native-entry management and provider commands available", () => {
  const manifest = readManifest();
  const commandIds = manifest.contributes.commands.map((item) => item.command);
  for (const command of [
    "manage",
    "selectEntry",
    "selectInlineEntry",
    "forgetEntry",
    "restoreEntry",
    "refreshModels",
    "setInlineSuggestionsModel",
    "showUsage",
    "testConnection",
    "openApiKeys",
    "diagnostics",
  ]) {
    assert.ok(commandIds.includes(`ampersandBridge.${command}`), `missing command: ${command}`);
  }
  for (const command of [
    "configureApiKey",
    "removeApiKey",
    "selectImageEntry",
    "setDefaultImageModel",
    "configureGatewaySession",
    "removeGatewaySession",
    "openUsage",
  ]) {
    assert.ok(!commandIds.includes(`ampersandBridge.${command}`), `unexpected command: ${command}`);
  }
  assert.match(
    manifest.contributes.commands.find((item) => item.command === "ampersandBridge.testConnection")?.title ?? "",
    /Test Inference/,
  );
});

test("ships no language-model tools and no image settings", () => {
  const manifest = readManifest();
  assert.equal(manifest.contributes.languageModelTools, undefined);
  const raw = JSON.stringify(manifest);
  assert.ok(!raw.includes("imageEntry"));
  assert.ok(!raw.includes("defaultImageModel"));
  assert.ok(!raw.includes("gatewaySession"));
});
