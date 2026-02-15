import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { cosineSimilarity } from "./Similarity.js";
import type { StoredVector } from "../types.js";

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
      const entries = Object.fromEntries(vectors);
      await writeFile(filePath, JSON.stringify(entries), "utf-8");
    },

    async load(filePath: string): Promise<void> {
      const raw = await readFile(filePath, "utf-8");
      const entries = JSON.parse(raw) as Record<string, StoredVector>;
      vectors.clear();
      for (const [id, data] of Object.entries(entries)) {
        vectors.set(id, data);
      }
    },

    get size(): number {
      return vectors.size;
    },

    clear(): void {
      vectors.clear();
    },
  };
}
