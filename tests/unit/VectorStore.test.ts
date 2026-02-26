import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createVectorStore, toSparse, fromSparse } from "../../src/embeddings/VectorStore.js";
import { cosineSimilarity } from "../../src/embeddings/Similarity.js";
import type { StoredVector } from "../../src/types.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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

  // ── Sparse vector compression tests ──────────────────────────

  describe("toSparse", () => {
    it("converts dense array to sparse format with indices and values", () => {
      const dense = [0, 0, 3.5, 0, 0, 1.2, 0, 0, 0, 0.8];
      const sparse = toSparse(dense);
      expect(sparse).toEqual({
        indices: [2, 5, 9],
        values: [3.5, 1.2, 0.8],
      });
    });

    it("returns empty arrays for all-zero vector", () => {
      const dense = [0, 0, 0, 0, 0];
      const sparse = toSparse(dense);
      expect(sparse).toEqual({ indices: [], values: [] });
    });

    it("includes all indices for fully non-zero vector", () => {
      const dense = [1, 2, 3];
      const sparse = toSparse(dense);
      expect(sparse).toEqual({
        indices: [0, 1, 2],
        values: [1, 2, 3],
      });
    });
  });

  describe("fromSparse", () => {
    it("converts sparse format back to dense array", () => {
      const sparse = { indices: [2, 5, 9], values: [3.5, 1.2, 0.8] };
      const dense = fromSparse(sparse, 10);
      expect(dense).toEqual([0, 0, 3.5, 0, 0, 1.2, 0, 0, 0, 0.8]);
    });

    it("returns all-zero array for empty sparse", () => {
      const sparse = { indices: [], values: [] };
      const dense = fromSparse(sparse, 5);
      expect(dense).toEqual([0, 0, 0, 0, 0]);
    });
  });

  describe("sparse roundtrip", () => {
    it("fromSparse(toSparse(dense)) produces identical array", () => {
      const dense = [0, 0, 3.5, 0, 0, 1.2, 0, 0, 0, 0.8];
      const restored = fromSparse(toSparse(dense), dense.length);
      expect(restored).toEqual(dense);
    });

    it("roundtrip preserves high-dimensional sparse TF-IDF-like vectors", () => {
      // Simulate a 1000-dimension vector with ~13 non-zero values (98.7% sparse)
      const dense = new Array(1000).fill(0);
      dense[42] = 0.0312;
      dense[100] = 0.157;
      dense[333] = 0.00891;
      dense[500] = 0.245;
      dense[750] = 0.0023;
      dense[999] = 0.112;
      dense[7] = 0.0045;
      dense[88] = 0.567;
      dense[201] = 0.034;
      dense[450] = 0.0178;
      dense[600] = 0.089;
      dense[800] = 0.00134;
      dense[950] = 0.0456;

      const restored = fromSparse(toSparse(dense), dense.length);
      expect(restored).toEqual(dense);
    });
  });

  describe("sparse format size reduction", () => {
    it("sparse format is significantly smaller than dense for typical TF-IDF vectors", () => {
      // ~11,000 dimensions, ~0.13% non-zero (like real TF-IDF)
      const dimensions = 11000;
      const nonZeroCount = 15;
      const dense = new Array(dimensions).fill(0);
      for (let i = 0; i < nonZeroCount; i++) {
        dense[i * 700] = 0.01 + Math.random() * 0.5;
      }

      const denseJsonSize = JSON.stringify(dense).length;
      const sparse = toSparse(dense);
      const sparseJsonSize = JSON.stringify(sparse).length;

      // Sparse should be dramatically smaller
      expect(sparseJsonSize).toBeLessThan(denseJsonSize * 0.05);
    });
  });

  describe("sparse persistence", () => {
    it("save() writes sparse format to disk", async () => {
      const store = createVectorStore();
      const vec = new Array(100).fill(0);
      vec[10] = 0.5;
      vec[50] = 0.3;
      store.upsert("c1", makeVector(vec));

      const filePath = join(tmpDir, "sparse-save.json");
      await store.save(filePath);

      const raw = JSON.parse(await readFile(filePath, "utf-8"));
      expect(raw.format).toBe("sparse");
      expect(raw.dimensions).toBe(100);
      expect(raw.vectors.c1.vector).toHaveProperty("indices");
      expect(raw.vectors.c1.vector).toHaveProperty("values");
      expect(raw.vectors.c1.vector.indices).toEqual([10, 50]);
      expect(raw.vectors.c1.vector.values).toEqual([0.5, 0.3]);
    });

    it("load() reads sparse format and restores dense vectors in memory", async () => {
      const store = createVectorStore();
      const vec = new Array(100).fill(0);
      vec[10] = 0.5;
      vec[50] = 0.3;
      store.upsert("c1", makeVector(vec, { repo: "repo-a", hash: "h1" }));

      const filePath = join(tmpDir, "sparse-load.json");
      await store.save(filePath);

      const loaded = createVectorStore();
      await loaded.load(filePath);
      expect(loaded.size).toBe(1);

      // Verify the in-memory vector is dense and correct
      const results = loaded.topK(vec, 1);
      expect(results[0].chunkId).toBe("c1");
      expect(results[0].score).toBeCloseTo(1.0, 5); // identical vector = similarity 1
      expect(results[0].meta.hash).toBe("h1");
      expect(results[0].meta.repo).toBe("repo-a");
    });

    it("load() is backward compatible with old dense format", async () => {
      // Write old-format file manually (dense arrays, no wrapper)
      const oldFormat: Record<string, StoredVector> = {
        c1: {
          vector: [1, 0, 0, 0, 0],
          repo: "repo-a",
          file: "doc.md",
          sectionPath: "# Test",
          priority: 1,
          hash: "old-hash",
        },
        c2: {
          vector: [0, 0, 0, 1, 0],
          repo: "repo-b",
          file: "other.md",
          sectionPath: "# Other",
          priority: 2,
          hash: "old-hash-2",
        },
      };

      const filePath = join(tmpDir, "old-format.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(filePath, JSON.stringify(oldFormat), "utf-8");

      const loaded = createVectorStore();
      await loaded.load(filePath);
      expect(loaded.size).toBe(2);

      const results = loaded.topK([1, 0, 0, 0, 0], 2);
      expect(results[0].chunkId).toBe("c1");
      expect(results[0].score).toBeCloseTo(1.0, 5);
      expect(results[0].meta.hash).toBe("old-hash");
    });

    it("cosine similarity works correctly with vectors restored from sparse format", async () => {
      const store = createVectorStore();
      const v1 = new Array(50).fill(0);
      v1[5] = 0.8;
      v1[20] = 0.3;
      v1[40] = 0.5;

      const v2 = new Array(50).fill(0);
      v2[5] = 0.2;
      v2[20] = 0.9;
      v2[30] = 0.1;

      store.upsert("c1", makeVector(v1));
      store.upsert("c2", makeVector(v2));

      // Compute expected similarities before save/load
      const query = new Array(50).fill(0);
      query[5] = 1.0;
      query[20] = 0.5;

      const expectedSim1 = cosineSimilarity(query, v1);
      const expectedSim2 = cosineSimilarity(query, v2);

      // Save and reload through sparse format
      const filePath = join(tmpDir, "sim-test.json");
      await store.save(filePath);
      const loaded = createVectorStore();
      await loaded.load(filePath);

      const results = loaded.topK(query, 2);
      expect(results[0].score).toBeCloseTo(expectedSim1 > expectedSim2 ? expectedSim1 : expectedSim2, 10);
      expect(results[1].score).toBeCloseTo(expectedSim1 > expectedSim2 ? expectedSim2 : expectedSim1, 10);
    });

    it("topK returns same results with sparse-restored vectors as with original dense vectors", async () => {
      const store = createVectorStore();

      // Create several vectors with realistic sparsity
      const vectors: number[][] = [];
      for (let v = 0; v < 5; v++) {
        const vec = new Array(200).fill(0);
        // Each vector gets ~5 non-zero values at different positions
        for (let j = 0; j < 5; j++) {
          vec[v * 40 + j * 8] = 0.1 + v * 0.1 + j * 0.05;
        }
        vectors.push(vec);
        store.upsert(`c${v}`, makeVector(vec, { repo: `repo-${v}` }));
      }

      const query = new Array(200).fill(0);
      query[0] = 1.0;
      query[8] = 0.5;

      // Get results from original dense vectors
      const originalResults = store.topK(query, 5);

      // Save, reload through sparse, query again
      const filePath = join(tmpDir, "topk-test.json");
      await store.save(filePath);
      const loaded = createVectorStore();
      await loaded.load(filePath);
      const restoredResults = loaded.topK(query, 5);

      // Same ordering and scores
      expect(restoredResults).toHaveLength(originalResults.length);
      for (let i = 0; i < originalResults.length; i++) {
        expect(restoredResults[i].chunkId).toBe(originalResults[i].chunkId);
        expect(restoredResults[i].score).toBeCloseTo(originalResults[i].score, 10);
      }
    });

    it("save + load roundtrip preserves all metadata fields", async () => {
      const store = createVectorStore();
      const vec = new Array(20).fill(0);
      vec[3] = 0.42;
      store.upsert(
        "chunk-abc",
        makeVector(vec, {
          repo: "my-repo",
          file: "path/to/file.md",
          sectionPath: "# Title > ## Subsection",
          priority: 5,
          hash: "sha256abc",
        })
      );

      const filePath = join(tmpDir, "meta-test.json");
      await store.save(filePath);
      const loaded = createVectorStore();
      await loaded.load(filePath);

      const results = loaded.topK(vec, 1);
      expect(results[0].chunkId).toBe("chunk-abc");
      expect(results[0].meta.repo).toBe("my-repo");
      expect(results[0].meta.file).toBe("path/to/file.md");
      expect(results[0].meta.sectionPath).toBe("# Title > ## Subsection");
      expect(results[0].meta.priority).toBe(5);
      expect(results[0].meta.hash).toBe("sha256abc");
    });
  });
});
