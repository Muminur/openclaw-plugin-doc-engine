import type { DocChunk, IndexStats, HashDiff, FileHashRecord } from "../types.js";

export interface RepoRegistryLike {
  scan(): Promise<{ repo: string; file: string; absolutePath: string }[]>;
  getRepoConfig(repo: string): {
    name: string;
    path: string;
    priority: number;
    type: "core" | "extension";
  } | undefined;
}

export interface FileHasherLike {
  hashFile(path: string): Promise<string>;
  loadHashes(storagePath: string): Promise<Record<string, FileHashRecord>>;
  saveHashes(storagePath: string, hashes: Record<string, FileHashRecord>): Promise<void>;
  diffHashes(
    stored: Record<string, FileHashRecord>,
    current: Record<string, string>
  ): HashDiff;
}

export interface SecretScannerLike {
  clean(text: string): string;
  shouldSkipFile(filePath: string): boolean;
}

export interface MarkdownChunkerLike {
  chunk(content: string, opts: { maxTokens: number; repo: string; file: string }): DocChunk[];
}

export interface TfIdfLike {
  embed(text: string): number[];
  addDocument(id: string, text: string): void;
  save(path: string): Promise<void>;
  load(path: string): Promise<void>;
}

export interface VectorStoreLike {
  upsert(id: string, vector: number[], meta?: Record<string, unknown>): void;
  remove(id: string): void;
  size(): number;
  save(path: string): Promise<void>;
  load(path: string): Promise<void>;
  clear(): void;
}

export interface IndexBuilderDeps {
  repoRegistry: RepoRegistryLike;
  fileHasher: FileHasherLike;
  secretScanner: SecretScannerLike;
  markdownChunker: MarkdownChunkerLike;
  tfidf: TfIdfLike;
  vectorStore: VectorStoreLike;
  readFile: (path: string) => Promise<string>;
  chunkIndex: Map<string, DocChunk>;
  storagePath: string;
  chunkMaxTokens: number;
  secretPatterns: string[];
}

export interface IndexBuilder {
  buildIndex(full?: boolean): Promise<IndexStats>;
}

export function createIndexBuilder(deps: IndexBuilderDeps): IndexBuilder {
  const {
    repoRegistry,
    fileHasher,
    secretScanner,
    markdownChunker,
    tfidf,
    vectorStore,
    readFile,
    chunkIndex,
    storagePath,
    chunkMaxTokens,
  } = deps;

  const hashStoragePath = `${storagePath}/hashes.json`;

  return {
    async buildIndex(full = false): Promise<IndexStats> {
      if (full) {
        vectorStore.clear();
        chunkIndex.clear();
      }

      // Scan all repos
      const files = await repoRegistry.scan();

      // Compute current hashes
      const currentHashes: Record<string, string> = {};
      for (const f of files) {
        currentHashes[f.file] = await fileHasher.hashFile(f.absolutePath);
      }

      // Load stored hashes and diff
      const storedHashes = full
        ? {}
        : await fileHasher.loadHashes(hashStoragePath);
      const diff = fileHasher.diffHashes(storedHashes, currentHashes);

      // Remove chunks for removed files
      for (const removedFile of diff.removed) {
        for (const [id, chunk] of chunkIndex) {
          if (chunk.file === removedFile) {
            vectorStore.remove(id);
            chunkIndex.delete(id);
          }
        }
      }

      // Process added + changed files
      const filesToProcess = [...diff.added, ...diff.changed];
      const filesByRepo = new Map<string, typeof files>();
      for (const f of files) {
        if (filesToProcess.includes(f.file)) {
          const list = filesByRepo.get(f.repo) ?? [];
          list.push(f);
          filesByRepo.set(f.repo, list);
        }
      }

      const repoStats: IndexStats["repos"] = {};
      let totalChunks = 0;
      const processedFiles = new Set<string>();

      for (const [repo, repoFiles] of filesByRepo) {
        let repoChunks = 0;
        for (const f of repoFiles) {
          if (secretScanner.shouldSkipFile(f.file)) continue;

          const content = await readFile(f.absolutePath);
          const cleaned = secretScanner.clean(content);
          const chunks = markdownChunker.chunk(cleaned, {
            maxTokens: chunkMaxTokens,
            repo: f.repo,
            file: f.file,
          });

          for (const chunk of chunks) {
            const vector = tfidf.embed(chunk.text);
            vectorStore.upsert(chunk.chunkId, vector);
            chunkIndex.set(chunk.chunkId, chunk);
            repoChunks++;
          }

          processedFiles.add(f.file);
        }

        repoStats[repo] = {
          files: repoFiles.length,
          chunks: repoChunks,
          lastIndexed: new Date().toISOString(),
        };
        totalChunks += repoChunks;
      }

      // Count existing chunks from unchanged files
      for (const [, chunk] of chunkIndex) {
        if (!processedFiles.has(chunk.file) && !diff.removed.includes(chunk.file)) {
          totalChunks++;
        }
      }

      // Save hashes
      const newHashes: Record<string, FileHashRecord> = {};
      for (const f of files) {
        newHashes[f.file] = {
          path: f.absolutePath,
          hash: currentHashes[f.file],
          repo: f.repo,
          lastIndexed: new Date().toISOString(),
        };
      }
      await fileHasher.saveHashes(hashStoragePath, newHashes);

      return {
        totalChunks,
        totalFiles: files.length,
        repos: repoStats,
        storageBytes: 0,
      };
    },
  };
}
