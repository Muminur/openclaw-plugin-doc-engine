import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createIndexBuilder,
  type IndexBuilderDeps,
} from "../../src/indexing/IndexBuilder.js";
import type { DocChunk, FileHashRecord, HashDiff } from "../../src/types.js";

function createMockDeps(): IndexBuilderDeps {
  const chunkIndex = new Map<string, DocChunk>();

  return {
    repoRegistry: {
      scan: vi.fn().mockResolvedValue([
        { repo: "core-docs", file: "guide.md", absolutePath: "/repos/core-docs/guide.md" },
        { repo: "core-docs", file: "config.md", absolutePath: "/repos/core-docs/config.md" },
      ]),
      getRepoConfig: vi.fn().mockReturnValue({
        name: "core-docs",
        path: "/repos/core-docs",
        priority: 1,
        type: "core",
      }),
    },
    fileHasher: {
      hashFile: vi.fn().mockResolvedValue("abc123"),
      loadHashes: vi.fn().mockResolvedValue({}),
      saveHashes: vi.fn().mockResolvedValue(undefined),
      diffHashes: vi.fn().mockReturnValue({
        added: ["guide.md", "config.md"],
        changed: [],
        removed: [],
        unchanged: [],
      } as HashDiff),
    },
    secretScanner: {
      clean: vi.fn((text: string) => text),
      shouldSkipFile: vi.fn().mockReturnValue(false),
    },
    markdownChunker: {
      chunk: vi.fn().mockReturnValue([
        {
          chunkId: "chunk-1",
          repo: "core-docs",
          file: "guide.md",
          sectionPath: "# Guide",
          text: "Guide content",
          hash: "h1",
          tokenCount: 4,
        },
      ] as DocChunk[]),
    },
    tfidf: {
      embed: vi.fn().mockReturnValue([0.5, 0.3]),
      embedBatch: vi.fn().mockReturnValue([[0.5, 0.3]]),
      dimensions: 2,
      addDocument: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
    },
    vectorStore: {
      upsert: vi.fn(),
      remove: vi.fn(),
      size: vi.fn().mockReturnValue(0),
      query: vi.fn().mockReturnValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn(),
    },
    readFile: vi.fn().mockResolvedValue("# Guide\n\nGuide content"),
    chunkIndex,
    storagePath: "/tmp/test-storage",
    chunkMaxTokens: 500,
    secretPatterns: [],
  };
}

describe("IndexBuilder", () => {
  let deps: IndexBuilderDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("scans repos via repoRegistry", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex();
    expect(deps.repoRegistry.scan).toHaveBeenCalled();
  });

  it("computes file hashes for discovered files", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex();
    expect(deps.fileHasher.hashFile).toHaveBeenCalled();
  });

  it("diffs hashes for incremental indexing", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex();
    expect(deps.fileHasher.diffHashes).toHaveBeenCalled();
  });

  it("cleans text through SecretScanner", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex();
    expect(deps.secretScanner.clean).toHaveBeenCalled();
  });

  it("skips files flagged by SecretScanner", async () => {
    deps.secretScanner.shouldSkipFile = vi.fn().mockReturnValue(true);
    const builder = createIndexBuilder(deps);
    const stats = await builder.buildIndex();
    expect(deps.markdownChunker.chunk).not.toHaveBeenCalled();
    expect(stats.totalChunks).toBe(0);
  });

  it("chunks cleaned markdown content", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex();
    expect(deps.markdownChunker.chunk).toHaveBeenCalled();
  });

  it("embeds chunks and upserts into vector store", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex();
    expect(deps.tfidf.embed).toHaveBeenCalled();
    expect(deps.vectorStore.upsert).toHaveBeenCalled();
  });

  it("populates chunkIndex", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex();
    expect(deps.chunkIndex.size).toBeGreaterThan(0);
  });

  it("returns IndexStats with correct structure", async () => {
    const builder = createIndexBuilder(deps);
    const stats = await builder.buildIndex();
    expect(stats).toHaveProperty("totalChunks");
    expect(stats).toHaveProperty("totalFiles");
    expect(stats).toHaveProperty("repos");
    expect(stats).toHaveProperty("storageBytes");
    expect(typeof stats.totalChunks).toBe("number");
    expect(typeof stats.totalFiles).toBe("number");
  });

  it("on full rebuild, clears vector store first", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex(true);
    expect(deps.vectorStore.clear).toHaveBeenCalled();
  });

  it("on incremental, only processes added/changed files", async () => {
    deps.fileHasher.diffHashes = vi.fn().mockReturnValue({
      added: ["guide.md"],
      changed: [],
      removed: [],
      unchanged: ["config.md"],
    });
    const builder = createIndexBuilder(deps);
    await builder.buildIndex(false);
    // readFile should only be called for added files, not unchanged
    const readCalls = (deps.readFile as ReturnType<typeof vi.fn>).mock.calls;
    const calledPaths = readCalls.map((c: unknown[]) => c[0]);
    expect(calledPaths.some((p: string) => p.includes("guide"))).toBe(true);
  });

  it("removes chunks for removed files", async () => {
    // Put a chunk in the index for a file that will be removed
    deps.chunkIndex.set("old-chunk", {
      chunkId: "old-chunk",
      repo: "core-docs",
      file: "removed.md",
      sectionPath: "# Old",
      text: "old content",
      hash: "old-hash",
      tokenCount: 3,
    });
    deps.fileHasher.diffHashes = vi.fn().mockReturnValue({
      added: [],
      changed: [],
      removed: ["removed.md"],
      unchanged: [],
    });
    deps.repoRegistry.scan = vi.fn().mockResolvedValue([]);
    const builder = createIndexBuilder(deps);
    await builder.buildIndex(false);
    expect(deps.vectorStore.remove).toHaveBeenCalledWith("old-chunk");
  });

  it("saves hashes after indexing", async () => {
    const builder = createIndexBuilder(deps);
    await builder.buildIndex();
    expect(deps.fileHasher.saveHashes).toHaveBeenCalled();
  });
});
