import { describe, it, expect, vi } from "vitest";
import {
  createRetrievalEngine,
  type RetrievalEngineDeps,
} from "../../src/retrieval/RetrievalEngine.js";
import type { DocChunk, SearchResult } from "../../src/types.js";

function makeChunk(id: string, text: string, repo = "repo-a"): DocChunk {
  return {
    chunkId: id,
    repo,
    file: "doc.md",
    sectionPath: `# Section ${id}`,
    text,
    hash: `hash-${id}`,
    tokenCount: Math.ceil(text.length / 4),
  };
}

function makeStoredVector(
  id: string,
  vector: number[],
  repo = "repo-a",
  priority = 1
) {
  return {
    vector,
    repo,
    file: "doc.md",
    sectionPath: `# Section ${id}`,
    priority,
    hash: `hash-${id}`,
  };
}

function createMockDeps(overrides?: Partial<RetrievalEngineDeps>): RetrievalEngineDeps {
  const chunks = new Map<string, DocChunk>();
  const c1 = makeChunk("c1", "first chunk about configuration");
  const c2 = makeChunk("c2", "second chunk about models");
  const c3 = makeChunk("c3", "third chunk about deployment");
  const c4 = makeChunk("c4", "fourth chunk from extensions", "repo-ext");
  chunks.set("c1", c1);
  chunks.set("c2", c2);
  chunks.set("c3", c3);
  chunks.set("c4", c4);

  return {
    tfidf: {
      embed: vi.fn().mockReturnValue([0.5, 0.3, 0.2]),
      embedBatch: vi.fn().mockReturnValue([[0.5, 0.3, 0.2]]),
      dimensions: 3,
    },
    vectorStore: {
      query: vi.fn().mockReturnValue([
        { id: "c1", score: 0.95 },
        { id: "c2", score: 0.85 },
        { id: "c3", score: 0.75 },
        { id: "c4", score: 0.65 },
      ]),
      upsert: vi.fn(),
      remove: vi.fn(),
      size: vi.fn().mockReturnValue(4),
    },
    conflictResolver: {
      resolve: (results: SearchResult[]) => results,
    },
    chunkIndex: chunks,
    repoMeta: new Map([
      ["repo-a", { type: "core" as const, priority: 1 }],
      ["repo-ext", { type: "extension" as const, priority: 5 }],
    ]),
    ...overrides,
  };
}

describe("RetrievalEngine", () => {
  it("returns search results sorted by score", () => {
    const deps = createMockDeps();
    const engine = createRetrievalEngine(deps);
    const results = engine.search("configuration");
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("embeds query via tfidf", () => {
    const deps = createMockDeps();
    const engine = createRetrievalEngine(deps);
    engine.search("test query");
    expect(deps.tfidf.embed).toHaveBeenCalledWith("test query");
  });

  it("over-fetches topK * 2 from vector store", () => {
    const deps = createMockDeps();
    const engine = createRetrievalEngine(deps);
    engine.search("query", { topK: 2 });
    expect(deps.vectorStore.query).toHaveBeenCalledWith(
      expect.any(Array),
      4 // topK * 2
    );
  });

  it("applies repoFilter", () => {
    const deps = createMockDeps();
    const engine = createRetrievalEngine(deps);
    const results = engine.search("query", { repoFilter: "repo-ext" });
    for (const r of results) {
      expect(r.repo).toBe("repo-ext");
    }
  });

  it("limits results to topK", () => {
    const deps = createMockDeps();
    const engine = createRetrievalEngine(deps);
    const results = engine.search("query", { topK: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("runs results through conflict resolver", () => {
    const resolveFn = vi.fn((results: SearchResult[]) => results.slice(0, 1));
    const deps = createMockDeps({
      conflictResolver: { resolve: resolveFn },
    });
    const engine = createRetrievalEngine(deps);
    const results = engine.search("query", { topK: 10 });
    expect(resolveFn).toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it("handles empty vector store results", () => {
    const deps = createMockDeps({
      vectorStore: {
        query: vi.fn().mockReturnValue([]),
        upsert: vi.fn(),
        remove: vi.fn(),
        size: vi.fn().mockReturnValue(0),
      },
    });
    const engine = createRetrievalEngine(deps);
    const results = engine.search("nothing");
    expect(results).toEqual([]);
  });

  it("skips chunks not found in chunkIndex", () => {
    const deps = createMockDeps({
      vectorStore: {
        query: vi.fn().mockReturnValue([
          { id: "c1", score: 0.9 },
          { id: "missing", score: 0.8 },
        ]),
        upsert: vi.fn(),
        remove: vi.fn(),
        size: vi.fn().mockReturnValue(2),
      },
    });
    const engine = createRetrievalEngine(deps);
    const results = engine.search("test");
    expect(results.every((r) => r.chunkId !== "missing")).toBe(true);
  });

  it("enriches results with repoType and repoPriority", () => {
    const deps = createMockDeps();
    const engine = createRetrievalEngine(deps);
    const results = engine.search("query");
    const coreResult = results.find((r) => r.repo === "repo-a");
    const extResult = results.find((r) => r.repo === "repo-ext");
    if (coreResult) {
      expect(coreResult.repoType).toBe("core");
      expect(coreResult.repoPriority).toBe(1);
    }
    if (extResult) {
      expect(extResult.repoType).toBe("extension");
      expect(extResult.repoPriority).toBe(5);
    }
  });
});
