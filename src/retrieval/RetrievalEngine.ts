import type { DocChunk, SearchResult, SearchOptions } from "../types.js";

export interface TfIdfLike {
  embed(text: string): number[];
  embedBatch(texts: string[]): number[][];
  readonly dimensions: number;
}

export interface VectorStoreLike {
  query(vector: number[], topK: number): { id: string; score: number }[];
  upsert(id: string, vector: number[], meta?: Record<string, unknown>): void;
  remove(id: string): void;
  size(): number;
}

export interface ConflictResolverLike {
  resolve(results: SearchResult[]): SearchResult[];
}

export interface RetrievalEngineDeps {
  tfidf: TfIdfLike;
  vectorStore: VectorStoreLike;
  conflictResolver: ConflictResolverLike;
  chunkIndex: Map<string, DocChunk>;
  repoMeta: Map<string, { type: "core" | "extension"; priority: number }>;
}

export interface RetrievalEngine {
  search(query: string, opts?: SearchOptions): SearchResult[];
}

export function createRetrievalEngine(deps: RetrievalEngineDeps): RetrievalEngine {
  const { tfidf, vectorStore, conflictResolver, chunkIndex, repoMeta } = deps;

  return {
    search(query: string, opts?: SearchOptions): SearchResult[] {
      const topK = opts?.topK ?? 10;
      const queryVector = tfidf.embed(query);

      // Over-fetch for dedup
      const candidates = vectorStore.query(queryVector, topK * 2);

      // Map to SearchResults, skip missing chunks
      let results: SearchResult[] = [];
      for (const { id, score } of candidates) {
        const chunk = chunkIndex.get(id);
        if (!chunk) continue;

        const meta = repoMeta.get(chunk.repo);
        results.push({
          ...chunk,
          score,
          repoType: meta?.type ?? "extension",
          repoPriority: meta?.priority ?? 999,
        });
      }

      // Apply repoFilter
      if (opts?.repoFilter) {
        results = results.filter((r) => r.repo === opts.repoFilter);
      }

      // Run through conflict resolver
      results = conflictResolver.resolve(results);

      // Limit to topK
      return results.slice(0, topK);
    },
  };
}
