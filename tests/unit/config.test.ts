import { describe, it, expect } from "vitest";
import { defaultConfig, mergeConfig } from "../../src/config/defaults.js";
import { configSchema } from "../../src/config/schema.js";

describe("defaultConfig", () => {
  it("has expected default values", () => {
    expect(defaultConfig.repositories).toEqual([]);
    expect(defaultConfig.storage).toBe("./storage");
    expect(defaultConfig.chunkMaxTokens).toBe(800);
    expect(defaultConfig.topK).toBe(5);
    expect(defaultConfig.watchEnabled).toBe(true);
    expect(defaultConfig.watchDebounceMs).toBe(2000);
    expect(defaultConfig.secretPatterns).toHaveLength(4);
  });
});

describe("mergeConfig", () => {
  it("returns defaults when given empty partial", () => {
    const result = mergeConfig({});
    expect(result).toEqual(defaultConfig);
  });

  it("overrides scalar values", () => {
    const result = mergeConfig({ topK: 10, chunkMaxTokens: 500 });
    expect(result.topK).toBe(10);
    expect(result.chunkMaxTokens).toBe(500);
    // Other defaults preserved
    expect(result.storage).toBe("./storage");
  });

  it("overrides array values completely", () => {
    const repos = [{ name: "r", path: "/tmp/r", priority: 1, type: "core" as const }];
    const result = mergeConfig({ repositories: repos });
    expect(result.repositories).toEqual(repos);
  });

  it("overrides secretPatterns", () => {
    const result = mergeConfig({ secretPatterns: ["custom-.*"] });
    expect(result.secretPatterns).toEqual(["custom-.*"]);
  });
});

describe("configSchema", () => {
  it("exports the schema object", () => {
    expect(configSchema).toBeDefined();
    expect(configSchema.type).toBe("object");
    expect(configSchema.properties).toHaveProperty("repositories");
    expect(configSchema.properties).toHaveProperty("storage");
    expect(configSchema.properties).toHaveProperty("topK");
  });
});
