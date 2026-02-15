import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createVectorStore } from "../../src/embeddings/VectorStore.js";
import { cosineSimilarity } from "../../src/embeddings/Similarity.js";
import type { StoredVector } from "../../src/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeVector(
  vector: number[],
  overrides?: Partial<StoredVector>
): StoredVector {
  return {
    vector,
    repo: overrides?.repo ?? "repo-a",
    file: overrides?.file ?? "doc.md",
    sectionPath: overrides?.sectionPath ?? "# Test",
    priority: overrides?.priority ?? 1,
    hash: overrides?.hash ?? "abc123",
  };
}

describe("VectorStore", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vectorstore-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("upsert adds a vector, size increases", () => {
    const store = createVectorStore();
    expect(store.size).toBe(0);
    store.upsert("c1", makeVector([1, 0, 0]));
    expect(store.size).toBe(1);
    store.upsert("c2", makeVector([0, 1, 0]));
    expect(store.size).toBe(2);
  });

  it("upsert same chunkId updates (replaces)", () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0]));
    expect(store.size).toBe(1);
    store.upsert("c1", makeVector([0, 1, 0], { hash: "updated" }));
    expect(store.size).toBe(1);
    // Verify it was replaced by querying
    const results = store.topK([0, 1, 0], 1);
    expect(results[0].meta.hash).toBe("updated");
  });

  it("remove decreases size", () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0]));
    store.upsert("c2", makeVector([0, 1, 0]));
    expect(store.size).toBe(2);
    store.remove("c1");
    expect(store.size).toBe(1);
  });

  it("remove non-existent is no-op", () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0]));
    store.remove("non-existent");
    expect(store.size).toBe(1);
  });

  it("topK returns correct number of results", () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0]));
    store.upsert("c2", makeVector([0, 1, 0]));
    store.upsert("c3", makeVector([0, 0, 1]));
    const results = store.topK([1, 0, 0], 2);
    expect(results).toHaveLength(2);
  });

  it("topK results sorted by score descending", () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0]));
    store.upsert("c2", makeVector([0.9, 0.1, 0]));
    store.upsert("c3", makeVector([0, 0, 1]));
    const results = store.topK([1, 0, 0], 3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("topK with repo filter only returns matching repo", () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0], { repo: "repo-a" }));
    store.upsert("c2", makeVector([0.9, 0.1, 0], { repo: "repo-b" }));
    store.upsert("c3", makeVector([0.8, 0.2, 0], { repo: "repo-a" }));
    const results = store.topK([1, 0, 0], 10, { repo: "repo-a" });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.meta.repo).toBe("repo-a");
    }
  });

  it("topK with k > size returns all", () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0]));
    store.upsert("c2", makeVector([0, 1, 0]));
    const results = store.topK([1, 0, 0], 100);
    expect(results).toHaveLength(2);
  });

  it("topK with empty store returns empty", () => {
    const store = createVectorStore();
    const results = store.topK([1, 0, 0], 5);
    expect(results).toEqual([]);
  });

  it("save + load round-trips all vectors correctly", async () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0], { repo: "repo-a", hash: "h1" }));
    store.upsert("c2", makeVector([0, 1, 0], { repo: "repo-b", hash: "h2" }));

    const filePath = join(tmpDir, "vectors.json");
    await store.save(filePath);

    const loaded = createVectorStore();
    await loaded.load(filePath);
    expect(loaded.size).toBe(2);

    const results = loaded.topK([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].chunkId).toBe("c1");
    expect(results[0].meta.hash).toBe("h1");
  });

  it("clear empties the store", () => {
    const store = createVectorStore();
    store.upsert("c1", makeVector([1, 0, 0]));
    store.upsert("c2", makeVector([0, 1, 0]));
    expect(store.size).toBe(2);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.topK([1, 0, 0], 10)).toEqual([]);
  });

  it("topK scores match expected cosine similarity values", () => {
    const store = createVectorStore();
    const v1 = [1, 0, 0];
    const v2 = [0.6, 0.8, 0];
    const query = [1, 0, 0];
    store.upsert("c1", makeVector(v1));
    store.upsert("c2", makeVector(v2));

    const results = store.topK(query, 2);
    const expectedScore1 = cosineSimilarity(query, v1);
    const expectedScore2 = cosineSimilarity(query, v2);

    expect(results[0].score).toBeCloseTo(expectedScore1, 5);
    expect(results[1].score).toBeCloseTo(expectedScore2, 5);
  });
});
