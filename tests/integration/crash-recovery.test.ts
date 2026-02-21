/**
 * Integration tests for crash-recovery scenarios around vector dimension mismatch.
 *
 * These tests simulate real production crash scenarios — specifically the 10591 vs 10686
 * dimension mismatch observed in production — where the storage files end up in an
 * inconsistent state between tfidf.json and vectors.json.
 *
 * Scenario A: Clean start → index → stop → corrupt vectors.json → restart → search works
 * Scenario B: Partial save (tfidf.json updated but vectors.json stale) → restart → search works
 * Scenario C: Clean start from empty storage → works correctly (regression guard)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngine } from "../../src/engine.js";
import { createTfIdfEngine } from "../../src/embeddings/TfIdfEngine.js";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Write hashes.json so the engine believes all listed files are unchanged.
 * This prevents runIndex() from re-indexing on the next start, which is
 * critical for reproducing "stale vectors survive restart" bugs.
 */
async function writeUpToDateHashes(
  hashesPath: string,
  files: Array<{
    absolutePath: string;
    relPath: string;
    repo: string;
    content: string;
  }>
): Promise<void> {
  const hashes: Record<string, unknown> = {};
  for (const f of files) {
    hashes[f.relPath] = {
      path: f.absolutePath,
      hash: sha256(f.content),
      repo: f.repo,
      lastIndexed: new Date().toISOString(),
    };
  }
  await writeFile(hashesPath, JSON.stringify(hashes), "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared doc content for all scenarios
// ─────────────────────────────────────────────────────────────────────────────

const GATEWAY_DOC = `# Gateway Configuration

The OpenClaw gateway configuration lives at ~/.openclaw/openclaw.json.

## Binding

By default the gateway binds to 127.0.0.1:18789.

## Logging

Logs are written to /tmp/openclaw/openclaw-YYYY-MM-DD.log.

## Models

Configure your primary model and optional fallback chain.
Each fallback must be a plain model ID like minimax/MiniMax-M2.1.
`;

const SKILLS_DOC = `# Skills System

Skills extend the bot with new commands and behaviours.

## Installation

Place the skill directory under ~/.openclaw/skills/.
Each skill must contain a SKILL.md file.

## Activation

Skills are activated by adding them to the skills array in openclaw.json.
Use the /skills list command to inspect loaded skills at runtime.
`;

const TROUBLESHOOT_DOC = `# Troubleshooting

Common issues encountered when running the OpenClaw gateway.

## Gateway Not Starting

Check whether port 18789 is already in use.
Inspect logs at /tmp/openclaw/ for startup errors.

## Model Errors

A 429 rate-limit error means the primary model quota is exhausted.
The gateway will automatically fall through the fallback chain.

## Authentication

Session tokens expire. Run openclaw auth refresh to renew them.
`;

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A — corrupt vectors.json after clean index
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario A: corrupt vectors.json after clean index", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-crash-a-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await writeFile(join(repoDir, "gateway.md"), GATEWAY_DOC);
    await writeFile(join(repoDir, "skills.md"), SKILLS_DOC);
    await writeFile(join(repoDir, "troubleshoot.md"), TROUBLESHOOT_DOC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("restart after vectors.json corruption yields working search (no throw)", async () => {
    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    // === Phase 1: Clean start — index normally, stop (saves state) ===
    const engine1 = createEngine(config, storageDir);
    await engine1.start();
    const statsAfterFirstRun = engine1.getStats();
    expect(statsAfterFirstRun.totalFiles).toBe(3);
    expect(statsAfterFirstRun.totalChunks).toBeGreaterThan(0);
    await engine1.stop();

    // === Phase 2: Simulate crash — overwrite vectors.json with wrong dimensions ===
    // This mimics the 10591 vs 10686 production scenario:
    // tfidf.json was updated (larger vocab) but vectors.json is from a prior run.
    const vectorsPath = join(storageDir, "vectors.json");
    const tfidfPath = join(storageDir, "tfidf.json");

    const tfidfRaw = JSON.parse(await readFile(tfidfPath, "utf-8")) as {
      vocabulary: string[];
    };
    const realDim = tfidfRaw.vocabulary.length;

    // Produce a mismatch by ±95 dimensions — same magnitude as the production bug
    const corruptDim = realDim > 95 ? realDim - 95 : realDim + 95;

    const corruptVectors = {
      "corrupt-chunk-1": {
        vector: new Array(corruptDim).fill(0.1),
        repo: "openclaw-docs",
        file: "gateway.md",
        sectionPath: "# Gateway Configuration",
        priority: 1,
        hash: "stale-hash-from-prior-run",
      },
      "corrupt-chunk-2": {
        vector: new Array(corruptDim).fill(0.05),
        repo: "openclaw-docs",
        file: "skills.md",
        sectionPath: "# Skills System",
        priority: 1,
        hash: "stale-hash-skills",
      },
    };
    await writeFile(vectorsPath, JSON.stringify(corruptVectors), "utf-8");

    // Freeze hashes.json so the engine sees NO file changes — stale vectors survive
    await writeUpToDateHashes(join(storageDir, "hashes.json"), [
      {
        absolutePath: join(repoDir, "gateway.md"),
        relPath: "gateway.md",
        repo: "openclaw-docs",
        content: GATEWAY_DOC,
      },
      {
        absolutePath: join(repoDir, "skills.md"),
        relPath: "skills.md",
        repo: "openclaw-docs",
        content: SKILLS_DOC,
      },
      {
        absolutePath: join(repoDir, "troubleshoot.md"),
        relPath: "troubleshoot.md",
        repo: "openclaw-docs",
        content: TROUBLESHOOT_DOC,
      },
    ]);

    // === Phase 3: Restart — must auto-heal, then search must work ===
    const engine2 = createEngine(config, storageDir);
    await engine2.start();

    // This is the production crash point: "Vector length mismatch: N vs M"
    await expect(
      engine2.search("gateway configuration openclaw.json")
    ).resolves.toEqual(expect.any(Array));

    // After healing the engine should return relevant results
    const results = await engine2.search("gateway logging models");
    expect(results.length).toBeGreaterThan(0);

    await engine2.stop();
  });

  it("search returns relevant content after corruption recovery", async () => {
    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    // Clean index
    const engine1 = createEngine(config, storageDir);
    await engine1.start();
    await engine1.stop();

    // Read actual tfidf to get real dimensions
    const tfidfRaw = JSON.parse(
      await readFile(join(storageDir, "tfidf.json"), "utf-8")
    ) as { vocabulary: string[] };
    const realDim = tfidfRaw.vocabulary.length;
    const wrongDim = realDim + 100;

    // Corrupt vectors.json with oversized vectors
    await writeFile(
      join(storageDir, "vectors.json"),
      JSON.stringify({
        "chunk-troubleshoot": {
          vector: new Array(wrongDim).fill(0.03),
          repo: "openclaw-docs",
          file: "troubleshoot.md",
          sectionPath: "# Troubleshooting",
          priority: 1,
          hash: "old-hash",
        },
      }),
      "utf-8"
    );

    await writeUpToDateHashes(join(storageDir, "hashes.json"), [
      {
        absolutePath: join(repoDir, "gateway.md"),
        relPath: "gateway.md",
        repo: "openclaw-docs",
        content: GATEWAY_DOC,
      },
      {
        absolutePath: join(repoDir, "skills.md"),
        relPath: "skills.md",
        repo: "openclaw-docs",
        content: SKILLS_DOC,
      },
      {
        absolutePath: join(repoDir, "troubleshoot.md"),
        relPath: "troubleshoot.md",
        repo: "openclaw-docs",
        content: TROUBLESHOOT_DOC,
      },
    ]);

    const engine2 = createEngine(config, storageDir);
    await engine2.start();

    // Query specifically for troubleshooting content
    const results = await engine2.search("troubleshoot gateway errors 429");
    expect(Array.isArray(results)).toBe(true);
    // At minimum it must not throw; if results exist they should be relevant
    if (results.length > 0) {
      const hasTroubleshootContent = results.some(
        (r) =>
          r.file.includes("troubleshoot") ||
          r.text.toLowerCase().includes("gateway") ||
          r.text.toLowerCase().includes("error")
      );
      expect(hasTroubleshootContent).toBe(true);
    }

    await engine2.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B — partial save: tfidf.json updated with new vocab, vectors.json stale
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario B: partial save — tfidf.json updated but vectors.json stale", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-crash-b-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await mkdir(storageDir, { recursive: true });
    await writeFile(join(repoDir, "gateway.md"), GATEWAY_DOC);
    await writeFile(join(repoDir, "skills.md"), SKILLS_DOC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("restart after partial save recovers and search works", async () => {
    // Simulate partial save:
    // tfidf.json has a LARGER vocabulary (just saved with new words from a new doc)
    // vectors.json is from BEFORE the new vocabulary — dimensions don't match
    const tfidfSmall = createTfIdfEngine();
    tfidfSmall.fit([GATEWAY_DOC, SKILLS_DOC]);
    const smallDim = tfidfSmall.dimensions;

    const tfidfLarge = createTfIdfEngine();
    tfidfLarge.fit([
      GATEWAY_DOC,
      SKILLS_DOC,
      TROUBLESHOOT_DOC, // new document just added to the index — caused vocab growth
    ]);
    const largeDim = tfidfLarge.dimensions;

    // tfidf.json reflects the UPDATED (larger) vocabulary
    await writeFile(
      join(storageDir, "tfidf.json"),
      JSON.stringify(tfidfLarge.serialize()),
      "utf-8"
    );

    // vectors.json is from BEFORE the vocabulary was updated (smallDim)
    const staleVectors = {
      "chunk-gw-1": {
        vector: new Array(smallDim).fill(0.04),
        repo: "openclaw-docs",
        file: "gateway.md",
        sectionPath: "# Gateway Configuration",
        priority: 1,
        hash: sha256(GATEWAY_DOC),
      },
      "chunk-sk-1": {
        vector: new Array(smallDim).fill(0.06),
        repo: "openclaw-docs",
        file: "skills.md",
        sectionPath: "# Skills System",
        priority: 1,
        hash: sha256(SKILLS_DOC),
      },
    };
    await writeFile(
      join(storageDir, "vectors.json"),
      JSON.stringify(staleVectors),
      "utf-8"
    );

    // chunks.json matches the stale vectors
    await writeFile(
      join(storageDir, "chunks.json"),
      JSON.stringify([
        {
          chunkId: "chunk-gw-1",
          text: GATEWAY_DOC.slice(0, 200),
          repo: "openclaw-docs",
          file: "gateway.md",
          sectionPath: "# Gateway Configuration",
          hash: sha256(GATEWAY_DOC),
          tokenCount: 40,
        },
        {
          chunkId: "chunk-sk-1",
          text: SKILLS_DOC.slice(0, 200),
          repo: "openclaw-docs",
          file: "skills.md",
          sectionPath: "# Skills System",
          hash: sha256(SKILLS_DOC),
          tokenCount: 38,
        },
      ]),
      "utf-8"
    );

    // hashes.json marks both files as up-to-date — no re-indexing on restart
    await writeUpToDateHashes(join(storageDir, "hashes.json"), [
      {
        absolutePath: join(repoDir, "gateway.md"),
        relPath: "gateway.md",
        repo: "openclaw-docs",
        content: GATEWAY_DOC,
      },
      {
        absolutePath: join(repoDir, "skills.md"),
        relPath: "skills.md",
        repo: "openclaw-docs",
        content: SKILLS_DOC,
      },
    ]);

    // Verify that there IS a dimension mismatch to detect
    expect(largeDim).toBeGreaterThan(smallDim);

    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    // Restart — must detect tfidf dim (largeDim) != stored vector dim (smallDim) and heal
    const engine = createEngine(config, storageDir);
    await engine.start();

    await expect(
      engine.search("gateway configuration binding port")
    ).resolves.toEqual(expect.any(Array));

    await engine.stop();
  });

  it("state-version.json written on stop reflects actual dimensions", async () => {
    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();
    await engine.stop();

    // state-version.json must exist — it's the commit marker written last by saveState()
    const stateVersionPath = join(storageDir, "state-version.json");
    const raw = await readFile(stateVersionPath, "utf-8");
    const sv = JSON.parse(raw) as {
      dimensions: number;
      vectorCount: number;
      savedAt: string;
    };

    expect(sv.dimensions).toBeGreaterThan(0);
    expect(sv.vectorCount).toBeGreaterThan(0);
    expect(typeof sv.savedAt).toBe("string");

    // Cross-check: dimensions must match the tfidf.json vocabulary size
    const tfidfRaw = JSON.parse(
      await readFile(join(storageDir, "tfidf.json"), "utf-8")
    ) as { vocabulary: string[] };
    expect(sv.dimensions).toBe(tfidfRaw.vocabulary.length);
  });

  it("search after partial-save recovery returns correct repo metadata", async () => {
    // Build mismatched state: tfidf = large vocab, vectors = small dim
    const tfidfSmall = createTfIdfEngine();
    tfidfSmall.fit([GATEWAY_DOC]);
    const smallDim = tfidfSmall.dimensions;

    const tfidfLarge = createTfIdfEngine();
    tfidfLarge.fit([GATEWAY_DOC, SKILLS_DOC]);
    const largeDim = tfidfLarge.dimensions;
    expect(largeDim).toBeGreaterThan(smallDim);

    await writeFile(
      join(storageDir, "tfidf.json"),
      JSON.stringify(tfidfLarge.serialize()),
      "utf-8"
    );
    await writeFile(
      join(storageDir, "vectors.json"),
      JSON.stringify({
        "chunk-gw-meta": {
          vector: new Array(smallDim).fill(0.05),
          repo: "openclaw-docs",
          file: "gateway.md",
          sectionPath: "# Gateway Configuration",
          priority: 1,
          hash: sha256(GATEWAY_DOC),
        },
      }),
      "utf-8"
    );
    await writeFile(
      join(storageDir, "chunks.json"),
      JSON.stringify([
        {
          chunkId: "chunk-gw-meta",
          text: GATEWAY_DOC.slice(0, 150),
          repo: "openclaw-docs",
          file: "gateway.md",
          sectionPath: "# Gateway Configuration",
          hash: sha256(GATEWAY_DOC),
          tokenCount: 30,
        },
      ]),
      "utf-8"
    );
    await writeUpToDateHashes(join(storageDir, "hashes.json"), [
      {
        absolutePath: join(repoDir, "gateway.md"),
        relPath: "gateway.md",
        repo: "openclaw-docs",
        content: GATEWAY_DOC,
      },
      {
        absolutePath: join(repoDir, "skills.md"),
        relPath: "skills.md",
        repo: "openclaw-docs",
        content: SKILLS_DOC,
      },
    ]);

    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();
    const results = await engine.search("gateway openclaw configuration");

    if (results.length > 0) {
      for (const r of results) {
        expect(r.repo).toBe("openclaw-docs");
        expect(typeof r.score).toBe("number");
        expect(typeof r.file).toBe("string");
      }
    }

    await engine.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario C — clean start from empty storage (regression guard)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario C: clean start from empty storage", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-crash-c-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await writeFile(join(repoDir, "gateway.md"), GATEWAY_DOC);
    await writeFile(join(repoDir, "skills.md"), SKILLS_DOC);
    await writeFile(join(repoDir, "troubleshoot.md"), TROUBLESHOOT_DOC);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("first-ever start with no storage files indexes and searches correctly", async () => {
    // Storage directory does NOT exist yet — engine must create it
    await rm(storageDir, { recursive: true, force: true });

    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();

    const stats = engine.getStats();
    expect(stats.totalFiles).toBe(3);
    expect(stats.totalChunks).toBeGreaterThan(0);
    expect(stats.repos["openclaw-docs"]).toBeDefined();

    const results = await engine.search("gateway configuration openclaw");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);

    await engine.stop();
  });

  it("search returns results scoped to correct repo on clean start", async () => {
    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();

    const results = await engine.search("authentication session token");
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r.repo).toBe("openclaw-docs");
    }

    await engine.stop();
  });

  it("second start with persisted state returns same file count as first", async () => {
    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine1 = createEngine(config, storageDir);
    await engine1.start();
    const stats1 = engine1.getStats();
    await engine1.stop();

    // Second start should load from persisted state — same file count
    const engine2 = createEngine(config, storageDir);
    await engine2.start();
    const stats2 = engine2.getStats();
    await engine2.stop();

    expect(stats2.totalFiles).toBe(stats1.totalFiles);
  });

  it("state-version.json exists after first stop with correct fields", async () => {
    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();
    await engine.stop();

    const stateVersionPath = join(storageDir, "state-version.json");
    const raw = await readFile(stateVersionPath, "utf-8");
    const sv = JSON.parse(raw) as Record<string, unknown>;

    expect(typeof sv.dimensions).toBe("number");
    expect(typeof sv.vectorCount).toBe("number");
    expect(typeof sv.savedAt).toBe("string");
    expect((sv.dimensions as number)).toBeGreaterThan(0);
    expect((sv.vectorCount as number)).toBeGreaterThan(0);
  });

  it("search on clean start returns results with valid score, file, and text fields", async () => {
    const config = {
      repositories: [
        { name: "openclaw-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    const engine = createEngine(config, storageDir);
    await engine.start();

    const results = await engine.search("skills installation openclaw");
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThan(0);
      expect(typeof r.file).toBe("string");
      expect(r.file.length).toBeGreaterThan(0);
      expect(typeof r.text).toBe("string");
      expect(r.text.length).toBeGreaterThan(0);
      expect(typeof r.repo).toBe("string");
    }

    await engine.stop();
  });
});
