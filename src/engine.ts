import { readFile as fsReadFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  DocEngineConfig,
  DocChunk,
  SearchResult,
  SearchOptions,
  IndexStats,
  StoredVector,
} from "./types.js";
import { mergeConfig } from "./config/defaults.js";
import { createRepoRegistry } from "./registry/RepoRegistry.js";
import { createScanner } from "./security/SecretScanner.js";
import { createTfIdfEngine } from "./embeddings/TfIdfEngine.js";
import { createVectorStore } from "./embeddings/VectorStore.js";
import { chunkMarkdown } from "./indexing/MarkdownChunker.js";
import {
  hashFile,
  loadHashes,
  saveHashes,
  diffHashes,
} from "./indexing/FileHasher.js";
import { resolveConflicts } from "./retrieval/ConflictResolver.js";
import { cosineSimilarity } from "./embeddings/Similarity.js";

export interface DocEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  index(full?: boolean): Promise<IndexStats>;
  getStats(): IndexStats;
}

export function createEngine(
  pluginConfig: Partial<DocEngineConfig>,
  storagePath?: string
): DocEngine {
  const config = mergeConfig(pluginConfig);
  const storage = storagePath ?? config.storage;

  // Components
  const registry = createRepoRegistry(config.repositories);
  const scanner = createScanner(
    config.secretPatterns.length > 0 ? config.secretPatterns : undefined
  );
  const tfidf = createTfIdfEngine();
  const vectorStore = createVectorStore();
  const chunkIndex = new Map<string, DocChunk>();

  // Paths
  const hashesPath = join(storage, "hashes.json");
  const tfidfPath = join(storage, "tfidf.json");
  const vectorsPath = join(storage, "vectors.json");
  const chunksPath = join(storage, "chunks.json");

  let currentStats: IndexStats = {
    totalChunks: 0,
    totalFiles: 0,
    repos: {},
    storageBytes: 0,
  };

  async function ensureStorage(): Promise<void> {
    await mkdir(storage, { recursive: true });
  }

  async function loadState(): Promise<void> {
    try {
      const raw = await fsReadFile(tfidfPath, "utf-8");
      tfidf.deserialize(JSON.parse(raw));
    } catch {
      // No saved state yet
    }
    try {
      await vectorStore.load(vectorsPath);
    } catch {
      // No saved state yet
    }
    try {
      const raw = await fsReadFile(chunksPath, "utf-8");
      const chunks: DocChunk[] = JSON.parse(raw);
      for (const chunk of chunks) {
        chunkIndex.set(chunk.chunkId, chunk);
      }
    } catch {
      // No saved state yet
    }
  }

  async function saveState(): Promise<void> {
    await ensureStorage();
    await writeFile(tfidfPath, JSON.stringify(tfidf.serialize()), "utf-8");
    await vectorStore.save(vectorsPath);
    await writeFile(chunksPath, JSON.stringify([...chunkIndex.values()]), "utf-8");
  }

  async function runIndex(full = false): Promise<IndexStats> {
    if (full) {
      vectorStore.clear();
      chunkIndex.clear();
    }

    // Scan repos — returns Map<repoName, absolutePaths[]>
    const scanResult = await registry.scan();

    // Build flat file list with repo context
    const allFiles: { repo: string; file: string; absolutePath: string }[] = [];
    for (const [repoName, absPaths] of scanResult) {
      const repoConfig = registry.getRepo(repoName);
      if (!repoConfig) continue;
      const basePath = repoConfig.path.startsWith("~/")
        ? join(process.env.HOME ?? "", repoConfig.path.slice(2))
        : repoConfig.path;
      for (const absPath of absPaths) {
        const relPath = relative(basePath, absPath);
        allFiles.push({ repo: repoName, file: relPath, absolutePath: absPath });
      }
    }

    // Compute current hashes
    const currentHashes: Record<string, string> = {};
    for (const f of allFiles) {
      currentHashes[f.file] = await hashFile(f.absolutePath);
    }

    // Load stored hashes and diff
    const storedHashes = full ? {} : await loadHashes(hashesPath);
    const diff = diffHashes(storedHashes, currentHashes);

    // Remove chunks for removed files
    for (const removedFile of diff.removed) {
      for (const [id, chunk] of chunkIndex) {
        if (chunk.file === removedFile) {
          vectorStore.remove(id);
          chunkIndex.delete(id);
        }
      }
    }

    // Collect all texts for TF-IDF fitting
    const filesToProcess = [...diff.added, ...diff.changed];
    const allTexts: string[] = [];
    const fileContents = new Map<string, string>();

    for (const f of allFiles) {
      if (!filesToProcess.includes(f.file)) continue;
      if (scanner.shouldSkipFile(f.file)) continue;
      const content = await fsReadFile(f.absolutePath, "utf-8");
      const cleaned = scanner.clean(content);
      fileContents.set(f.file, cleaned);
      allTexts.push(cleaned);
    }

    // Fit TF-IDF on all documents if we have new content
    const oldDimensions = tfidf.dimensions;
    if (allTexts.length > 0) {
      // Also include existing chunk texts for better vocabulary
      const existingTexts = [...chunkIndex.values()].map((c) => c.text);
      tfidf.fit([...existingTexts, ...allTexts]);
    }

    // If vocabulary grew, re-embed ALL existing vectors to match new dimensions
    if (tfidf.dimensions !== oldDimensions && chunkIndex.size > 0) {
      for (const [chunkId, chunk] of chunkIndex) {
        const repoConfig = registry.getRepo(chunk.repo);
        const newVector = tfidf.embed(chunk.text);
        vectorStore.upsert(chunkId, {
          vector: newVector,
          repo: chunk.repo,
          file: chunk.file,
          sectionPath: chunk.sectionPath,
          priority: repoConfig?.priority ?? 999,
          hash: chunk.hash,
        });
      }
    }

    // Chunk and embed
    const repoStats: IndexStats["repos"] = {};
    let totalChunks = 0;

    for (const [repoName] of scanResult) {
      const repoFiles = allFiles.filter(
        (f) => f.repo === repoName && filesToProcess.includes(f.file)
      );
      let repoChunkCount = 0;

      for (const f of repoFiles) {
        const cleaned = fileContents.get(f.file);
        if (!cleaned) continue; // skipped by scanner

        const chunks = chunkMarkdown(cleaned, {
          maxTokens: config.chunkMaxTokens,
          repo: f.repo,
          file: f.file,
        });

        const repoConfig = registry.getRepo(f.repo);
        for (const chunk of chunks) {
          const vector = tfidf.embed(chunk.text);
          vectorStore.upsert(chunk.chunkId, {
            vector,
            repo: chunk.repo,
            file: chunk.file,
            sectionPath: chunk.sectionPath,
            priority: repoConfig?.priority ?? 999,
            hash: chunk.hash,
          });
          chunkIndex.set(chunk.chunkId, chunk);
          repoChunkCount++;
        }
      }

      const totalRepoFiles = allFiles.filter((f) => f.repo === repoName).length;
      if (totalRepoFiles > 0) {
        repoStats[repoName] = {
          files: totalRepoFiles,
          chunks: repoChunkCount,
          lastIndexed: new Date().toISOString(),
        };
      }
      totalChunks += repoChunkCount;
    }

    // Count existing chunks from unchanged files
    for (const [, chunk] of chunkIndex) {
      const isProcessed = filesToProcess.includes(chunk.file);
      const isRemoved = diff.removed.includes(chunk.file);
      if (!isProcessed && !isRemoved) {
        totalChunks++;
      }
    }

    // Save hashes
    const newHashes: Record<string, import("./types.js").FileHashRecord> = {};
    for (const f of allFiles) {
      newHashes[f.file] = {
        path: f.absolutePath,
        hash: currentHashes[f.file],
        repo: f.repo,
        lastIndexed: new Date().toISOString(),
      };
    }
    await saveHashes(hashesPath, newHashes);

    currentStats = {
      totalChunks,
      totalFiles: allFiles.length,
      repos: repoStats,
      storageBytes: 0,
    };

    return currentStats;
  }

  return {
    async start(): Promise<void> {
      await ensureStorage();
      await loadState();
      await runIndex(false);
      await saveState();
    },

    async stop(): Promise<void> {
      await saveState();
    },

    async search(
      query: string,
      opts?: SearchOptions
    ): Promise<SearchResult[]> {
      const topK = opts?.topK ?? config.topK;
      const queryVector = tfidf.embed(query);

      // Query vector store — over-fetch for dedup
      const candidates = vectorStore.topK(queryVector, topK * 2, opts?.repoFilter ? { repo: opts.repoFilter } : undefined);

      // Map to SearchResults
      let results: SearchResult[] = [];
      for (const { chunkId, score, meta } of candidates) {
        const chunk = chunkIndex.get(chunkId);
        if (!chunk) continue;

        const repoConfig = registry.getRepo(chunk.repo);
        results.push({
          ...chunk,
          score,
          repoType: repoConfig?.type ?? "extension",
          repoPriority: repoConfig?.priority ?? 999,
        });
      }

      // Filter out zero-score results (query had no vocabulary overlap)
      results = results.filter((r) => r.score > 0);

      // Conflict resolution
      results = resolveConflicts(results);

      return results.slice(0, topK);
    },

    async index(full = false): Promise<IndexStats> {
      const stats = await runIndex(full);
      await saveState();
      return stats;
    },

    getStats(): IndexStats {
      return { ...currentStats };
    },
  };
}
