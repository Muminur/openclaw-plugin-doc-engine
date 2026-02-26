import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { cosineSimilarity } from "./Similarity.js";
import type { StoredVector } from "../types.js";

// ── Sparse vector types and conversion functions ────────────

export interface SparseVector {
  indices: number[];
  values: number[];
}

export function toSparse(dense: number[]): SparseVector {
  const indices: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < dense.length; i++) {
    if (dense[i] !== 0) {
      indices.push(i);
      values.push(dense[i]);
    }
  }
  return { indices, values };
}

export function fromSparse(sparse: SparseVector, dimensions: number): number[] {
  const dense = new Array(dimensions).fill(0);
  for (let i = 0; i < sparse.indices.length; i++) {
    dense[sparse.indices[i]] = sparse.values[i];
  }
  return dense;
}

// ── Persisted format types ──────────────────────────────────

interface SparseStoredEntry {
  vector: SparseVector;
  repo: string;
  file: string;
  sectionPath: string;
  priority: number;
  hash: string;
}

interface SparseFileFormat {
  format: "sparse";
  dimensions: number;
  vectors: Record<string, SparseStoredEntry>;
}

// ── VectorStore ─────────────────────────────────────────────

export interface VectorStore {
  upsert(chunkId: string, data: StoredVector): void;
  remove(chunkId: string): void;
  topK(
    queryVector: number[],
    k: number,
    filter?: { repo?: string }
  ): Array<{ chunkId: string; score: number; meta: StoredVector }>;
  load(filePath: string): Promise<void>;
  save(filePath: string): Promise<void>;
  size: number;
  clear(): void;
  getAnyVectorDim(): number | null;
}

export function createVectorStore(): VectorStore {
  const vectors = new Map<string, StoredVector>();

  return {
    upsert(chunkId: string, data: StoredVector): void {
      vectors.set(chunkId, data);
    },

    remove(chunkId: string): void {
      vectors.delete(chunkId);
    },

    topK(
      queryVector: number[],
      k: number,
      filter?: { repo?: string }
    ): Array<{ chunkId: string; score: number; meta: StoredVector }> {
      const scored: Array<{ chunkId: string; score: number; meta: StoredVector }> = [];

      for (const [chunkId, data] of vectors) {
        if (filter?.repo && data.repo !== filter.repo) continue;
        const score = cosineSimilarity(queryVector, data.vector);
        scored.push({ chunkId, score, meta: data });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    },

    async save(filePath: string): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });

      // Determine dimensions from any stored vector
      let dimensions = 0;
      for (const [, data] of vectors) {
        dimensions = data.vector.length;
        break;
      }

      // Build sparse file format
      const sparseEntries: Record<string, SparseStoredEntry> = {};
      for (const [id, data] of vectors) {
        sparseEntries[id] = {
          vector: toSparse(data.vector),
          repo: data.repo,
          file: data.file,
          sectionPath: data.sectionPath,
          priority: data.priority,
          hash: data.hash,
        };
      }

      const output: SparseFileFormat = {
        format: "sparse",
        dimensions,
        vectors: sparseEntries,
      };

      await writeFile(filePath, JSON.stringify(output), "utf-8");
    },

    async load(filePath: string): Promise<void> {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      vectors.clear();

      // Detect format: new sparse format has { format: "sparse", dimensions, vectors }
      if (parsed.format === "sparse") {
        const sparse = parsed as SparseFileFormat;
        for (const [id, entry] of Object.entries(sparse.vectors)) {
          vectors.set(id, {
            vector: fromSparse(entry.vector, sparse.dimensions),
            repo: entry.repo,
            file: entry.file,
            sectionPath: entry.sectionPath,
            priority: entry.priority,
            hash: entry.hash,
          });
        }
      } else {
        // Legacy dense format: Record<string, StoredVector>
        const entries = parsed as Record<string, StoredVector>;
        for (const [id, data] of Object.entries(entries)) {
          vectors.set(id, data);
        }
      }
    },

    get size(): number {
      return vectors.size;
    },

    clear(): void {
      vectors.clear();
    },

    getAnyVectorDim(): number | null {
      for (const [, data] of vectors) {
        return data.vector.length;
      }
      return null;
    },
  };
}
