# OpenClaw Plugin: Doc Engine

**Multi-repo semantic documentation retrieval for OpenClaw** — indexes your Markdown documentation across multiple repositories and provides fast, offline semantic search via TF-IDF vectorization. No external APIs required.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

---

## Installation

### Quick Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Muminur/openclaw-plugin-doc-engine/main/scripts/install.sh | bash
```

### Manual Installation

```bash
git clone https://github.com/Muminur/openclaw-plugin-doc-engine.git ~/.openclaw/plugins/doc-engine
cd ~/.openclaw/plugins/doc-engine
npm install && npm run build
```

### Configure OpenClaw

Add the plugin to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "enabled": true,
    "load": {
      "paths": ["~/.openclaw/plugins/doc-engine"]
    },
    "entries": {
      "doc-engine": {
        "enabled": true,
        "config": {
          "repositories": [
            {
              "name": "official-docs",
              "path": "/path/to/your/openclaw-docs",
              "priority": 1,
              "type": "core",
              "glob": "**/*.md"
            }
          ]
        }
      }
    }
  }
}
```

You can add multiple repositories with different priorities. Lower priority numbers indicate higher authority — when two repos contain documentation on the same topic, the higher-authority source wins during conflict resolution.

### Activate

Restart the gateway to load the plugin:

```bash
openclaw gateway restart
```

The engine will scan, chunk, and index all configured repositories on startup. Subsequent restarts use persisted state and only re-index changed files.

---

## Architecture

```
Markdown Files --> Scanner --> Chunker --> TF-IDF --> Vector Store --> Search API
                     |                      |             |
               Secret Redact         Vocabulary Fit   Cosine Sim
```

### Design Principles

- **Multi-repo indexing** — Index documentation from any number of repositories simultaneously, each with configurable priority and type (`core` or `extension`).
- **TF-IDF vectorization** — Fully offline semantic search. No external embedding API calls, no network dependency. The vocabulary is fitted across all indexed documents.
- **SHA256 incremental indexing** — File hashes are tracked between runs. Only added or changed files are re-processed; unchanged files are skipped entirely.
- **Chunk persistence** — Chunks, vectors, TF-IDF model state, and file hashes are all persisted to disk (`chunks.json`, `vectors.json`, `tfidf.json`, `hashes.json`). Restarts are near-instant.
- **Secret scanning** — Configurable regex patterns detect and redact credentials, API keys, and tokens before content enters the index. Prevents accidental credential leakage.
- **OpenClaw Plugin API integration** — Registers four extension points: a background service (`doc-indexer`), a tool (`semantic_doc_search`), a CLI command group (`docsearch`), and a chat command (`/docsearch`).

---

## Module Reference

### Entry Point

#### `src/index.ts` — Plugin Registration

The plugin entry point. Exports a default plugin object that registers all four extension points with the OpenClaw Plugin API:

| Extension | Type | Identifier |
|-----------|------|------------|
| Background service | `registerService` | `doc-indexer` |
| Tool | `registerTool` | `semantic_doc_search` |
| CLI commands | `registerCli` | `docsearch` |
| Chat command | `registerCommand` | `/docsearch` |

The service starts the engine on gateway boot and stops it on shutdown. The tool, CLI, and command all delegate to the engine's `search()` method.

---

### Core Engine

#### `src/engine.ts` — Engine Orchestrator

The central coordinator. Exposes the `DocEngine` interface:

```typescript
interface DocEngine {
  start(): Promise<void>;    // Load persisted state, run incremental index
  stop(): Promise<void>;     // Persist state to disk
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  index(full?: boolean): Promise<IndexStats>;
  getStats(): IndexStats;
}
```

The `start()` lifecycle: load saved TF-IDF model, vectors, and chunks from disk, then run an incremental index pass. The `search()` pipeline: embed query via TF-IDF, retrieve candidates from vector store (over-fetching 2x for dedup headroom), map to `SearchResult` objects, filter zero-score results, apply conflict resolution, and return the top K.

When the TF-IDF vocabulary grows (new documents introduce new terms), the engine automatically re-embeds all existing vectors to match the new dimensionality.

#### `src/types.ts` — Type Definitions

All TypeScript interfaces used across the codebase:

| Interface | Purpose |
|-----------|---------|
| `RepoConfig` | Repository configuration (name, path, priority, type, glob) |
| `DocChunk` | A chunk of text with metadata (chunkId, repo, file, sectionPath, hash, tokenCount) |
| `SearchResult` | Extends `DocChunk` with `score`, `repoType`, and `repoPriority` |
| `SearchOptions` | Query options (`topK`, `repoFilter`) |
| `IndexStats` | Index statistics (total chunks, files, per-repo breakdown) |
| `StoredVector` | Vector with associated metadata for storage |
| `FileHashRecord` | File path, hash, repo, and last-indexed timestamp |
| `DocEngineConfig` | Full plugin configuration interface |
| `EmbeddingProvider` | Pluggable embedding interface (`embed`, `embedBatch`, `dimensions`) |
| `HashDiff` | Diff result: arrays of added, changed, removed, and unchanged paths |

---

### Configuration

#### `src/config/defaults.ts` — Default Configuration

Merges user-provided partial config with sensible defaults. Any field omitted from the plugin config falls back to the default value.

#### `src/config/schema.ts` — Schema Validation

JSON Schema definition for plugin configuration. Used for validation at load time.

---

### Embeddings

#### `src/embeddings/TfIdfEngine.ts` — TF-IDF Vectorizer

The core embedding engine. Implements term frequency-inverse document frequency vectorization.

Key operations:

- **`fit(documents: string[])`** — Build or rebuild the vocabulary from a corpus. Computes IDF weights for all terms. Called during indexing whenever new documents are added.
- **`embed(text: string): number[]`** — Convert a text string into a TF-IDF vector. Used for both document chunks (at index time) and queries (at search time).
- **`serialize()` / `deserialize()`** — Save and restore the fitted model (vocabulary + IDF weights) to/from JSON. Enables fast restarts without refitting.
- **`dimensions`** — The current vocabulary size (number of unique terms).

The vocabulary grows as new documents are indexed. When this happens, all previously stored vectors must be re-embedded to match the new dimensionality — the engine handles this automatically.

#### `src/embeddings/VectorStore.ts` — Vector Storage

In-memory vector store with persistence.

- **`upsert(id, entry)`** — Insert or update a vector by chunk ID.
- **`remove(id)`** — Delete a vector.
- **`topK(queryVector, k, filter?)`** — Retrieve the top K most similar vectors via cosine similarity, with optional metadata filtering (e.g., by repo name).
- **`clear()`** — Wipe all stored vectors (used during full re-index).
- **`load(path)` / `save(path)`** — Persist vectors to and from a JSON file on disk.

#### `src/embeddings/Similarity.ts` — Cosine Similarity

Implements the `cosineSimilarity(a, b)` function used by `VectorStore.topK()` to rank search results. Returns a value between 0 (no similarity) and 1 (identical direction).

---

### Indexing

#### `src/indexing/MarkdownChunker.ts` — Markdown-Aware Chunker

Splits Markdown documents into chunks that respect the heading hierarchy. Each chunk:

- Stays within the configured `chunkMaxTokens` limit (default: 800).
- Preserves its heading path (e.g., `# Configuration > ## Models > ### Fallbacks`) as the `sectionPath` field.
- Gets a deterministic `chunkId` derived from `SHA256(repo + file + sectionPath)`.

This ensures search results carry meaningful section context, not just raw text fragments.

#### `src/indexing/FileHasher.ts` — SHA256 File Hashing

Handles incremental indexing by tracking file content hashes.

- **`hashFile(path)`** — Compute the SHA256 hash of a file.
- **`loadHashes(path)` / `saveHashes(path, hashes)`** — Persist hash records between runs.
- **`diffHashes(stored, current)`** — Compare stored vs. current hashes. Returns a `HashDiff` with four arrays: `added`, `changed`, `removed`, `unchanged`. Only `added` and `changed` files need re-processing.

#### `src/indexing/IndexBuilder.ts` — Index Construction Helpers

Utility functions for building and managing the index data structures.

---

### Registry

#### `src/registry/RepoRegistry.ts` — Repository Registry

Manages the set of configured documentation repositories.

- **`scan()`** — Walk each repository's file tree using the configured glob pattern (default: `**/*.md`). Returns a `Map<repoName, absolutePaths[]>`.
- **`getRepo(name)`** — Look up a `RepoConfig` by name.

Supports both `core` and `extension` repository types. Core repositories have higher authority during conflict resolution.

---

### Retrieval

#### `src/retrieval/ConflictResolver.ts` — Priority-Based Conflict Resolution

When multiple repositories contain documentation on the same topic (overlapping `sectionPath` values), this module deduplicates results:

1. Groups results by normalized section path.
2. Within each group, selects the result from the highest-priority repo (lowest `priority` number).
3. `core` type repos always outrank `extension` type repos at the same priority level.

This ensures authoritative documentation is always surfaced first.

#### `src/retrieval/RetrievalEngine.ts` — Search Orchestration

Coordinates the retrieval pipeline: query embedding, vector store lookup, result mapping, and conflict resolution.

---

### Security

#### `src/security/SecretScanner.ts` — Secret Detection and Redaction

Prevents credentials from entering the search index. Operates in two modes:

- **`shouldSkipFile(path)`** — Returns `true` for files that should be excluded entirely (e.g., `.env`, `credentials.json`).
- **`clean(content)`** — Scans text content against configurable regex patterns and redacts matches before the content is chunked and indexed.

Default patterns detect common secret formats (API keys, tokens, passwords in config). Additional patterns can be added via the `secretPatterns` config option.

---

### Watchers

#### `src/watchers/RepoWatcher.ts` — File System Change Detection

Monitors indexed repositories for file changes using Node.js file system watchers. When a change is detected (after the debounce window), triggers an incremental re-index. Controlled by the `watchEnabled` and `watchDebounceMs` config options.

---

## Configuration Reference

All configuration lives under `plugins.entries.doc-engine.config` in `~/.openclaw/openclaw.json`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `repositories` | `RepoConfig[]` | `[]` | Array of documentation repositories to index |
| `storage` | `string` | `<plugin-dir>/storage` | Directory for persisted index data (vectors, hashes, chunks, TF-IDF model). **Must match the actual data directory** — if set, overrides the default. |
| `chunkMaxTokens` | `number` | `800` | Maximum token count per chunk |
| `topK` | `number` | `5` | Default number of search results returned |
| `watchEnabled` | `boolean` | `true` | Enable automatic re-indexing when files change |
| `watchDebounceMs` | `number` | `2000` | Debounce delay (ms) before re-indexing after a change |
| `secretPatterns` | `string[]` | `[]` | Additional regex patterns for secret redaction |

### Repository Configuration

Each entry in the `repositories` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique identifier for this repository |
| `path` | `string` | Yes | Absolute path to the repository root (supports `~/` expansion) |
| `priority` | `number` | Yes | Conflict resolution priority. Lower number = higher authority |
| `type` | `"core"` \| `"extension"` | Yes | Repository type. `core` outranks `extension` at equal priority |
| `glob` | `string` | No | File matching pattern. Default: `**/*.md` |

### Example: Multi-Repo Setup

```json
{
  "repositories": [
    {
      "name": "official-docs",
      "path": "~/projects/openclaw-docs",
      "priority": 1,
      "type": "core",
      "glob": "**/*.md"
    },
    {
      "name": "skills-catalog",
      "path": "~/projects/openclaw-skills",
      "priority": 2,
      "type": "extension",
      "glob": "skills/**/SKILL.md"
    },
    {
      "name": "internal-runbooks",
      "path": "~/docs/runbooks",
      "priority": 3,
      "type": "extension"
    }
  ]
}
```

---

## Usage

### Tool (from within OpenClaw conversations)

```
semantic_doc_search(query="gateway configuration", topK=5)
semantic_doc_search(query="webhook setup", repoFilter="official-docs")
```

Returns ranked results with source file, section path, relevance score, and text excerpt.

### CLI

```bash
# Search across all repos (shorthand)
openclaw docsearch "heartbeat configuration"

# Search with explicit subcommand and options
openclaw docsearch search "heartbeat configuration" -k 10

# Search within a specific repo
openclaw docsearch search "webhook" -r official-docs

# Force a full re-index (rebuilds everything from scratch)
openclaw docsearch index --full

# Show index statistics
openclaw docsearch status
```

### Chat Command

```
/docsearch heartbeat configuration
```

Returns the top 3 results formatted for quick reading directly in the chat interface. No model invocation needed — the search runs locally against the TF-IDF index.

---

## Development

### Prerequisites

- Node.js >= 20
- npm

### Build

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript to dist/
npm run lint       # Type check without emitting
```

### Test

```bash
npm test           # Run all tests (vitest)
npm run test:watch # Run in watch mode
```

Test coverage spans 138 tests across 15 test files:

| Test File | Covers |
|-----------|--------|
| `config.test.ts` | Default merging, schema validation |
| `ConflictResolver.test.ts` | Priority-based deduplication |
| `engine.test.ts` | Full engine lifecycle, search, indexing |
| `FileHasher.test.ts` | SHA256 hashing, diff computation |
| `full-pipeline.test.ts` | End-to-end integration tests |
| `IndexBuilder.test.ts` | Index construction helpers |
| `MarkdownChunker.test.ts` | Heading-aware chunking, token limits |
| `plugin-registration.test.ts` | Plugin API registration |
| `RepoRegistry.test.ts` | Repository scanning, glob matching |
| `RepoWatcher.test.ts` | File system change detection |
| `RetrievalEngine.test.ts` | Search orchestration |
| `SecretScanner.test.ts` | Secret detection and redaction |
| `Similarity.test.ts` | Cosine similarity computation |
| `TfIdfEngine.test.ts` | TF-IDF fit, embed, serialize/deserialize |
| `VectorStore.test.ts` | Vector storage, topK retrieval, persistence |

### Project Structure

```
plugin-doc-engine/
├── src/
│   ├── index.ts                    # Plugin entry point
│   ├── engine.ts                   # Core engine orchestrator
│   ├── types.ts                    # TypeScript interfaces
│   ├── config/
│   │   ├── defaults.ts             # Default configuration
│   │   └── schema.ts              # JSON schema validation
│   ├── embeddings/
│   │   ├── TfIdfEngine.ts         # TF-IDF vectorizer
│   │   ├── VectorStore.ts         # In-memory vector storage
│   │   └── Similarity.ts          # Cosine similarity
│   ├── indexing/
│   │   ├── MarkdownChunker.ts     # Markdown-aware chunking
│   │   ├── FileHasher.ts          # SHA256 incremental hashing
│   │   └── IndexBuilder.ts        # Index construction helpers
│   ├── registry/
│   │   └── RepoRegistry.ts        # Repository scanning
│   ├── retrieval/
│   │   ├── ConflictResolver.ts    # Priority-based dedup
│   │   └── RetrievalEngine.ts     # Search orchestration
│   ├── security/
│   │   └── SecretScanner.ts       # Secret detection/redaction
│   └── watchers/
│       └── RepoWatcher.ts         # File system watchers
├── tests/                          # 15 test files, 138 tests
├── storage/                        # Persisted index data (runtime)
├── openclaw.plugin.json            # Plugin manifest
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## License

MIT -- see [LICENSE](LICENSE) for details.

---

**Author:** Muminur
