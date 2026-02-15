// ============================================================
// Core domain types for plugin-doc-engine
// ============================================================

/** Configuration for a documentation repository to index */
export interface RepoConfig {
  name: string;
  path: string;
  priority: number; // Lower = higher authority
  type: "core" | "extension";
  glob?: string; // Default: "**/*.md"
}

/** A chunk of documentation text with metadata */
export interface DocChunk {
  chunkId: string; // SHA256(repo + file + sectionPath)
  repo: string;
  file: string; // Relative to repo root
  sectionPath: string; // e.g. "# Config > ## Models > ### Fallbacks"
  text: string;
  hash: string; // SHA256 of text content
  tokenCount: number;
}

/** A search result: a DocChunk with relevance scoring */
export interface SearchResult extends DocChunk {
  score: number; // Cosine similarity
  repoType: "core" | "extension";
  repoPriority: number;
}

/** Search options */
export interface SearchOptions {
  topK?: number;
  repoFilter?: string;
}

/** Statistics about the current index */
export interface IndexStats {
  totalChunks: number;
  totalFiles: number;
  repos: Record<
    string,
    { files: number; chunks: number; lastIndexed: string }
  >;
  storageBytes: number;
}

/** Stored vector with metadata */
export interface StoredVector {
  vector: number[];
  repo: string;
  file: string;
  sectionPath: string;
  priority: number;
  hash: string;
}

/** File hash record for incremental indexing */
export interface FileHashRecord {
  path: string;
  hash: string;
  repo: string;
  lastIndexed: string;
}

/** Plugin configuration (from plugins.entries.doc-engine.config) */
export interface DocEngineConfig {
  repositories: RepoConfig[];
  storage: string;
  chunkMaxTokens: number;
  topK: number;
  watchEnabled: boolean;
  watchDebounceMs: number;
  secretPatterns: string[];
  englishOnly: boolean;
}

/** Embedding provider interface (pluggable) */
export interface EmbeddingProvider {
  embed(text: string): number[];
  embedBatch(texts: string[]): number[][];
  readonly dimensions: number;
}

/** Diff result from FileHasher */
export interface HashDiff {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
}
