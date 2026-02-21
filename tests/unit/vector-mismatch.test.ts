import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngine } from "../../src/engine.js";
import { createTfIdfEngine } from "../../src/embeddings/TfIdfEngine.js";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

/**
 * TDD red-phase tests for the vector dimension mismatch bug.
 *
 * Root cause: After a crash between saving tfidf.json and vectors.json,
 * the stored vectors may have different dimensions than the loaded vocabulary.
 * engine.start() → loadState() loads both without validating dimensions.
 * The mismatch then causes cosineSimilarity() to throw during search().
 *
 * The key to reproducing: hashes.json must match the actual files so that
 * runIndex() sees NO changed files → no re-embedding → stale vectors persist.
 */

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Write a hashes.json that makes the engine believe all files are up-to-date */
async function writeUpToDateHashes(
  hashesPath: string,
  files: Array<{ absolutePath: string; relPath: string; repo: string; content: string }>
): Promise<void> {
  const hashes: Record<string, unknown> = {};
  for (const f of files) {
    hashes[f.relPath] = {
      path: f.absolutePath,
      hash: hashContent(f.content),
      repo: f.repo,
      lastIndexed: new Date().toISOString(),
    };
  }
  await writeFile(hashesPath, JSON.stringify(hashes), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Dimension Validation on Load
// ─────────────────────────────────────────────────────────────────────────────

describe("vector dimension validation after loadState", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  const FILE_CONTENT =
    "# Configuration\n\nThe gateway configuration lives in openclaw.json.\n\n## Models\n\nConfigure models with primary and fallback fields.\n";
  const FILE_CONTENT_2 =
    "# Installation\n\nInstall via npm: `npm install -g openclaw`.\n\n## Requirements\n\nNode.js 20+ is required.\n";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-dim-val-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await mkdir(storageDir, { recursive: true });

    await writeFile(join(repoDir, "config.md"), FILE_CONTENT);
    await writeFile(join(repoDir, "install.md"), FILE_CONTENT_2);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("engine detects and auto-heals stale vectors on startup — search works after restart with mismatched state", async () => {
    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    // === Step 1: First run — index normally ===
    const engine1 = createEngine(config, storageDir);
    await engine1.start();
    await engine1.stop();

    // === Step 2: Corrupt vectors.json with wrong-dimension vectors ===
    // (simulate crash: tfidf.json was updated but vectors.json is from a prior run)
    const vectorsPath = join(storageDir, "vectors.json");
    const tfidfPath = join(storageDir, "tfidf.json");

    const tfidfRaw = JSON.parse(await readFile(tfidfPath, "utf-8")) as {
      vocabulary: string[];
    };
    const realDim = tfidfRaw.vocabulary.length;
    const staleDim = realDim + 95; // guaranteed mismatch

    const staleVectors = {
      "chunk-stale-1": {
        vector: new Array(staleDim).fill(0.1),
        repo: "test-docs",
        file: "config.md",
        sectionPath: "# Configuration",
        priority: 1,
        hash: "stale-hash",
      },
    };
    await writeFile(vectorsPath, JSON.stringify(staleVectors), "utf-8");

    // === Step 3: Ensure hashes.json matches real files (no changes detected) ===
    // This is the crucial part — without this, runIndex() would re-embed and
    // accidentally fix the mismatch, hiding the bug.
    await writeUpToDateHashes(join(storageDir, "hashes.json"), [
      {
        absolutePath: join(repoDir, "config.md"),
        relPath: "config.md",
        repo: "test-docs",
        content: FILE_CONTENT,
      },
      {
        absolutePath: join(repoDir, "install.md"),
        relPath: "install.md",
        repo: "test-docs",
        content: FILE_CONTENT_2,
      },
    ]);

    // === Step 4: Second run — must detect mismatch and heal ===
    const engine2 = createEngine(config, storageDir);
    await engine2.start();

    // BUG: currently throws "Vector length mismatch: <realDim> vs <staleDim>"
    // EXPECTED (after fix): auto-heals and returns results
    const results = await engine2.search("configuration models");

    expect(Array.isArray(results)).toBe(true);

    await engine2.stop();
  });

  it("engine re-embeds all chunks when loaded vector dimensions differ from tfidf dimensions", async () => {
    // Build two TF-IDF engines with different vocabulary sizes
    const tfidfSmall = createTfIdfEngine();
    tfidfSmall.fit(["alpha beta gamma delta epsilon"]);
    const dimSmall = tfidfSmall.dimensions;

    const tfidfLarge = createTfIdfEngine();
    tfidfLarge.fit([
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron",
    ]);
    const dimLarge = tfidfLarge.dimensions;

    expect(dimLarge).toBeGreaterThan(dimSmall);

    const tfidfPath = join(storageDir, "tfidf.json");
    const vectorsPath = join(storageDir, "vectors.json");
    const chunksPath = join(storageDir, "chunks.json");
    const hashesPath = join(storageDir, "hashes.json");

    // tfidf.json = LARGE vocabulary (current)
    await writeFile(tfidfPath, JSON.stringify(tfidfLarge.serialize()), "utf-8");

    // vectors.json = SMALL dimension (stale — from before vocabulary grew)
    const staleVectors = {
      "chunk-0001": {
        vector: new Array(dimSmall).fill(0.05),
        repo: "test-docs",
        file: "config.md",
        sectionPath: "# Config",
        priority: 1,
        hash: "hash-abc",
      },
    };
    await writeFile(vectorsPath, JSON.stringify(staleVectors), "utf-8");

    // chunks.json — matches vectors.json
    await writeFile(
      chunksPath,
      JSON.stringify([
        {
          chunkId: "chunk-0001",
          text: "alpha beta gamma",
          repo: "test-docs",
          file: "config.md",
          sectionPath: "# Config",
          hash: "hash-abc",
          tokenCount: 3,
        },
      ]),
      "utf-8"
    );

    // hashes.json — real hash of config.md so runIndex() sees zero changes
    await writeUpToDateHashes(hashesPath, [
      {
        absolutePath: join(repoDir, "config.md"),
        relPath: "config.md",
        repo: "test-docs",
        content: FILE_CONTENT,
      },
      {
        absolutePath: join(repoDir, "install.md"),
        relPath: "install.md",
        repo: "test-docs",
        content: FILE_CONTENT_2,
      },
    ]);

    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();

    // BUG: throws "Vector length mismatch: <dimLarge> vs <dimSmall>"
    // EXPECTED: no throw — engine detected dim mismatch and re-embedded
    let threw = false;
    try {
      await engine.search("alpha beta");
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);

    await engine.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: Search Graceful Degradation
// ─────────────────────────────────────────────────────────────────────────────

describe("search handles vector mismatch gracefully", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  const GUIDE_CONTENT =
    "# User Guide\n\nWelcome to the documentation.\n\n## Getting Started\n\nFollow these steps to get started quickly.\n";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-search-graceful-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await mkdir(storageDir, { recursive: true });

    await writeFile(join(repoDir, "guide.md"), GUIDE_CONTENT);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("search() does NOT throw when stored vectors have mismatched dimensions", async () => {
    const tfidfPath = join(storageDir, "tfidf.json");
    const vectorsPath = join(storageDir, "vectors.json");
    const chunksPath = join(storageDir, "chunks.json");
    const hashesPath = join(storageDir, "hashes.json");

    // Build a tfidf with a known-size vocabulary
    const tfidf = createTfIdfEngine();
    const vocabWords = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    tfidf.fit([vocabWords]);
    const dim50 = tfidf.dimensions;
    await writeFile(tfidfPath, JSON.stringify(tfidf.serialize()), "utf-8");

    // Stored vectors with wrong (smaller) dimension
    const wrongDim = dim50 - 10;
    expect(wrongDim).toBeGreaterThan(0);

    await writeFile(
      vectorsPath,
      JSON.stringify({
        "chunk-abc": {
          vector: new Array(wrongDim).fill(0.02),
          repo: "test-docs",
          file: "guide.md",
          sectionPath: "# User Guide",
          priority: 1,
          hash: "abc-hash",
        },
      }),
      "utf-8"
    );

    await writeFile(
      chunksPath,
      JSON.stringify([
        {
          chunkId: "chunk-abc",
          text: vocabWords,
          repo: "test-docs",
          file: "guide.md",
          sectionPath: "# User Guide",
          hash: "abc-hash",
          tokenCount: 50,
        },
      ]),
      "utf-8"
    );

    // hashes.json with real file hash — no re-indexing triggered
    await writeUpToDateHashes(hashesPath, [
      {
        absolutePath: join(repoDir, "guide.md"),
        relPath: "guide.md",
        repo: "test-docs",
        content: GUIDE_CONTENT,
      },
    ]);

    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();

    // EXPECTED: returns Array (possibly empty) — does NOT throw
    // CURRENT BEHAVIOR: throws "Vector length mismatch: <dim50> vs <wrongDim>"
    await expect(engine.search("word0 word1 word2")).resolves.toEqual(
      expect.any(Array)
    );

    await engine.stop();
  });

  it("search() returns results or empty array (not throws) when query vector dim != stored vector dim", async () => {
    const tfidfPath = join(storageDir, "tfidf.json");
    const vectorsPath = join(storageDir, "vectors.json");
    const chunksPath = join(storageDir, "chunks.json");
    const hashesPath = join(storageDir, "hashes.json");

    const smallTfidf = createTfIdfEngine();
    smallTfidf.fit(["apple banana cherry date elderberry fig grape"]);
    const smallDim = smallTfidf.dimensions;

    const largeTfidf = createTfIdfEngine();
    largeTfidf.fit([
      "apple banana cherry date elderberry fig grape",
      "hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu",
    ]);
    const largeDim = largeTfidf.dimensions;

    expect(largeDim).toBeGreaterThan(smallDim);

    // tfidf uses LARGE vocab → queryVector will have largeDim dimensions
    await writeFile(tfidfPath, JSON.stringify(largeTfidf.serialize()), "utf-8");

    // stored vectors have SMALL dim → mismatch when cosineSimilarity is called
    await writeFile(
      vectorsPath,
      JSON.stringify({
        "stale-chunk-1": {
          vector: new Array(smallDim).fill(0.1),
          repo: "test-docs",
          file: "guide.md",
          sectionPath: "# Section",
          priority: 1,
          hash: "stale-hash-1",
        },
        "stale-chunk-2": {
          vector: new Array(smallDim).fill(0.2),
          repo: "test-docs",
          file: "guide.md",
          sectionPath: "## Subsection",
          priority: 1,
          hash: "stale-hash-2",
        },
      }),
      "utf-8"
    );

    await writeFile(
      chunksPath,
      JSON.stringify([
        {
          chunkId: "stale-chunk-1",
          text: "apple banana cherry",
          repo: "test-docs",
          file: "guide.md",
          sectionPath: "# Section",
          hash: "stale-hash-1",
          tokenCount: 3,
        },
        {
          chunkId: "stale-chunk-2",
          text: "date elderberry fig",
          repo: "test-docs",
          file: "guide.md",
          sectionPath: "## Subsection",
          hash: "stale-hash-2",
          tokenCount: 3,
        },
      ]),
      "utf-8"
    );

    // hashes.json matches real file — prevents re-indexing
    await writeUpToDateHashes(hashesPath, [
      {
        absolutePath: join(repoDir, "guide.md"),
        relPath: "guide.md",
        repo: "test-docs",
        content: GUIDE_CONTENT,
      },
    ]);

    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();

    // EXPECTED: graceful — empty results or auto-healed results, NOT a throw
    // CURRENT: throws "Vector length mismatch: <largeDim> vs <smallDim>"
    let results: unknown;
    let threw = false;
    try {
      results = await engine.search("apple banana");
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(Array.isArray(results)).toBe(true);

    await engine.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Partial Save Detection with Version Marker
// ─────────────────────────────────────────────────────────────────────────────

describe("partial save detection with version marker", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  const README_CONTENT =
    "# README\n\nThis is the project readme.\n\n## Overview\n\nAn overview of the project.\n";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-version-marker-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await mkdir(storageDir, { recursive: true });

    await writeFile(join(repoDir, "readme.md"), README_CONTENT);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("engine auto-heals dimension mismatch even when state-version.json is present", async () => {
    const stateVersionPath = join(storageDir, "state-version.json");
    const tfidfPath = join(storageDir, "tfidf.json");
    const vectorsPath = join(storageDir, "vectors.json");
    const chunksPath = join(storageDir, "chunks.json");
    const hashesPath = join(storageDir, "hashes.json");

    // Build tfidf with dim=100
    const tfidf = createTfIdfEngine();
    const words100 = Array.from({ length: 100 }, (_, i) => `term${i}`).join(" ");
    tfidf.fit([words100]);
    const dim100 = tfidf.dimensions;

    await writeFile(tfidfPath, JSON.stringify(tfidf.serialize()), "utf-8");

    // state-version.json says last complete save had dim=dim100, vectorCount=2
    await writeFile(
      stateVersionPath,
      JSON.stringify({
        dimensions: dim100,
        vectorCount: 2,
        savedAt: new Date().toISOString(),
      }),
      "utf-8"
    );

    // vectors.json from a prior run with dim=dim100-20 — partial save scenario
    const staleDim = dim100 - 20;
    await writeFile(
      vectorsPath,
      JSON.stringify({
        "chunk-v1": {
          vector: new Array(staleDim).fill(0.05),
          repo: "test-docs",
          file: "readme.md",
          sectionPath: "# README",
          priority: 1,
          hash: "v1-hash",
        },
        "chunk-v2": {
          vector: new Array(staleDim).fill(0.07),
          repo: "test-docs",
          file: "readme.md",
          sectionPath: "## Overview",
          priority: 1,
          hash: "v2-hash",
        },
      }),
      "utf-8"
    );

    await writeFile(
      chunksPath,
      JSON.stringify([
        {
          chunkId: "chunk-v1",
          text: "term0 term1 term2",
          repo: "test-docs",
          file: "readme.md",
          sectionPath: "# README",
          hash: "v1-hash",
          tokenCount: 3,
        },
        {
          chunkId: "chunk-v2",
          text: "term3 term4 term5",
          repo: "test-docs",
          file: "readme.md",
          sectionPath: "## Overview",
          hash: "v2-hash",
          tokenCount: 3,
        },
      ]),
      "utf-8"
    );

    // hashes.json — real hash so runIndex() sees no file changes
    await writeUpToDateHashes(hashesPath, [
      {
        absolutePath: join(repoDir, "readme.md"),
        relPath: "readme.md",
        repo: "test-docs",
        content: README_CONTENT,
      },
    ]);

    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);

    // The dimension guard in loadState() detects storedDim != tfidf.dimensions
    // and re-embeds all vectors. state-version.json is diagnostic metadata only
    // — the auto-healing relies on live dimension comparison, not the version file.
    await engine.start();

    await expect(engine.search("term0 term1")).resolves.toEqual(expect.any(Array));

    await engine.stop();
  });

  it("engine writes state-version.json with correct dimensions and vectorCount after saveState", async () => {
    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();
    await engine.stop();

    // Regression guard: state-version.json must be written with { dimensions, vectorCount }
    const stateVersionPath = join(storageDir, "state-version.json");

    let stateVersion: unknown = null;
    try {
      const raw = await readFile(stateVersionPath, "utf-8");
      stateVersion = JSON.parse(raw);
    } catch {
      stateVersion = null;
    }

    expect(stateVersion).not.toBeNull();
    expect(stateVersion).toHaveProperty("dimensions");
    expect(stateVersion).toHaveProperty("vectorCount");
    expect((stateVersion as { dimensions: number }).dimensions).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Orphaned Vector Cleanup
// ─────────────────────────────────────────────────────────────────────────────

describe("orphaned vector cleanup", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  const DOC_CONTENT =
    "# Docs\n\nSome documentation content.\n\n## Section\n\nMore details here.\n";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-orphaned-vec-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await mkdir(storageDir, { recursive: true });

    await writeFile(join(repoDir, "doc.md"), DOC_CONTENT);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("clears orphaned vectors when chunks.json is lost but vectors.json survives", async () => {
    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    // Step 1: Normal run — build state
    const engine1 = createEngine(config, storageDir);
    await engine1.start();
    await engine1.stop();

    // Step 2: Delete chunks.json to simulate partial crash (vectors survive, chunks lost)
    const chunksPath = join(storageDir, "chunks.json");
    await rm(chunksPath, { force: true });

    // Step 3: Restart — loadState loads vectors but chunkIndex is empty
    const engine2 = createEngine(config, storageDir);
    await engine2.start();

    // After restart + re-index, search should work without errors.
    // BUG: orphaned vectors with stale dimensions may persist and cause
    // "Vector length mismatch" if vocabulary changed between runs.
    // The guard at engine.ts:93 skips cleanup when chunkIndex.size === 0.
    const results = await engine2.search("documentation content");
    expect(Array.isArray(results)).toBe(true);

    // Verify state-version.json shows consistent state after save
    await engine2.stop();
    const stateVersionPath = join(storageDir, "state-version.json");
    const sv = JSON.parse(await readFile(stateVersionPath, "utf-8"));
    expect(sv.vectorCount).toBeGreaterThan(0);
    expect(sv.dimensions).toBeGreaterThan(0);
  });

  it("clears stale vectors when chunkIndex is empty but vectorStore has entries with mismatched dims", async () => {
    const tfidfPath = join(storageDir, "tfidf.json");
    const vectorsPath = join(storageDir, "vectors.json");
    const hashesPath = join(storageDir, "hashes.json");
    // No chunks.json — simulates loss

    // Build a tfidf with known vocabulary
    const tfidf = createTfIdfEngine();
    tfidf.fit(["alpha beta gamma delta epsilon zeta eta theta iota kappa"]);
    const currentDim = tfidf.dimensions;
    await writeFile(tfidfPath, JSON.stringify(tfidf.serialize()), "utf-8");

    // Orphaned vectors with DIFFERENT dimension (no matching chunks)
    const staleDim = currentDim + 30;
    await writeFile(
      vectorsPath,
      JSON.stringify({
        "orphan-1": {
          vector: new Array(staleDim).fill(0.05),
          repo: "test-docs",
          file: "doc.md",
          sectionPath: "# Docs",
          priority: 1,
          hash: "orphan-hash",
        },
      }),
      "utf-8"
    );

    // hashes.json matches real file
    await writeUpToDateHashes(hashesPath, [
      {
        absolutePath: join(repoDir, "doc.md"),
        relPath: "doc.md",
        repo: "test-docs",
        content: DOC_CONTENT,
      },
    ]);

    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);

    // EXPECTED: orphaned stale vectors are cleared during loadState,
    // then runIndex re-indexes the files normally, search works.
    // BUG: guard at engine.ts:93 requires chunkIndex.size > 0,
    // so orphaned vectors with wrong dim persist → "Vector length mismatch"
    // when runIndex adds new vectors with currentDim and topK iterates both.
    await engine.start();

    // Search must not throw
    await expect(engine.search("alpha beta")).resolves.toEqual(expect.any(Array));

    await engine.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: Empty Chunks/Vectors with Stale Hashes Recovery
// ─────────────────────────────────────────────────────────────────────────────

describe("empty chunks and vectors with stale hashes recovery", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  // Need 2+ files so IDF is non-zero (log(N/df) with N>1 and df<N)
  const DOC_A = "# Guide\n\nA helpful guide to getting started.\n\n## Setup\n\nFollow these steps.\n";
  const DOC_B = "# Reference\n\nAPI reference documentation.\n\n## Endpoints\n\nList of available endpoints.\n";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-stale-hashes-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await mkdir(storageDir, { recursive: true });

    await writeFile(join(repoDir, "guide.md"), DOC_A);
    await writeFile(join(repoDir, "reference.md"), DOC_B);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("triggers full re-index when chunks and vectors are empty but tfidf vocabulary exists", async () => {
    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    // Step 1: Normal run — build state
    const engine1 = createEngine(config, storageDir);
    await engine1.start();
    await engine1.stop();

    // Step 2: Wipe chunks.json and vectors.json but keep tfidf.json and hashes.json
    // This simulates a partial corruption where data files are lost but metadata survives
    await writeFile(join(storageDir, "chunks.json"), "[]", "utf-8");
    await writeFile(join(storageDir, "vectors.json"), "{}", "utf-8");

    // Step 3: Restart — loadState loads empty chunks/vectors but valid tfidf vocabulary
    // BUG: runIndex(false) sees hashes match → processes 0 files → 0 chunks forever
    // EXPECTED: detects state loss (vocab exists but no chunks), forces full re-index
    const engine2 = createEngine(config, storageDir);
    await engine2.start();

    const results = await engine2.search("guide setup");
    expect(results.length).toBeGreaterThan(0);

    await engine2.stop();
  });
});
