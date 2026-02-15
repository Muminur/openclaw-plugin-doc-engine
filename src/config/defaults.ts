import type { DocEngineConfig } from "../types.js";

export const defaultConfig: DocEngineConfig = {
  repositories: [],
  storage: "./storage",
  chunkMaxTokens: 800,
  topK: 5,
  watchEnabled: true,
  watchDebounceMs: 2000,
  secretPatterns: [
    "sk-[a-zA-Z0-9]{20,}",
    "AIza[a-zA-Z0-9_-]{35}",
    "ghp_[a-zA-Z0-9]{36}",
    "xoxb-[a-zA-Z0-9-]+",
  ],
};

export function mergeConfig(
  partial: Partial<DocEngineConfig>
): DocEngineConfig {
  return { ...defaultConfig, ...partial };
}
