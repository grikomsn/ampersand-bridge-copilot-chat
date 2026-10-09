import assert from "node:assert/strict";
import test from "node:test";
import { MODELS_DEV_API_URL, ModelsDevMetadata, normalizeModelsDevSnapshot, type MetadataCache } from "./metadata";

class Cache implements MetadataCache {
  value: unknown;
  get<T>(): T | undefined {
    return this.value as T;
  }
  async update(_key: string, value: unknown): Promise<void> {
    this.value = value;
  }
}
const payload = {
  aiand: {
    models: {
      m: {
        id: "m",
        description: "Model",
        limit: { context: 100, output: 20 },
        modalities: { input: ["text", "image"] },
        tool_call: true,
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["none", "high"] }],
        release_date: "2026-01-01",
      },
    },
  },
};

test("normalizes the Ampersand Bridge models.dev provider", () => {
  assert.deepEqual(normalizeModelsDevSnapshot(payload, 1).models.m, {
    id: "m",
    description: "Model",
    contextLength: 100,
    maxOutputTokens: 20,
    imageInput: true,
    toolCalling: true,
    reasoning: true,
    reasoningOptions: ["none", "high"],
    releaseDate: "2026-01-01",
  });
});

test("persists metadata and falls back to the snapshot after refresh failure", async () => {
  const cache = new Cache();
  const metadata = new ModelsDevMetadata(
    cache,
    async (input) => {
      assert.equal(String(input), MODELS_DEV_API_URL);
      return Response.json(payload);
    },
    () => 1,
  );
  assert.equal((await metadata.getOrRefresh()).models.m?.description, "Model");
  const stale = new ModelsDevMetadata(
    cache,
    async () => new Response("down", { status: 503 }),
    () => 99_999_999,
  );
  assert.equal((await stale.refresh()).models.m?.description, "Model");
});
