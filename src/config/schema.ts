export const configSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    repositories: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "path", "priority", "type"],
        properties: {
          name: { type: "string" },
          path: { type: "string" },
          priority: { type: "number", minimum: 1 },
          type: { type: "string", enum: ["core", "extension"] },
          glob: { type: "string" },
        },
      },
    },
    storage: { type: "string" },
    chunkMaxTokens: { type: "number", default: 800 },
    topK: { type: "number", default: 5 },
    watchEnabled: { type: "boolean", default: true },
    watchDebounceMs: { type: "number", default: 2000 },
    secretPatterns: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;
