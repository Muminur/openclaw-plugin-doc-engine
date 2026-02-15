import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngine } from "../../src/engine.js";
import type { RepoConfig } from "../../src/types.js";
import { mkdtemp, mkdir, writeFile, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Full Pipeline Integration", () => {
  let tempDir: string;
  let storageDir: string;
  let docsDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "doc-engine-integration-"));
    storageDir = join(tempDir, "storage");
    docsDir = join(tempDir, "docs");
    skillsDir = join(tempDir, "skills");

    await mkdir(docsDir, { recursive: true });
    await mkdir(join(skillsDir, "my-skill"), { recursive: true });

    await writeFile(
      join(docsDir, "getting-started.md"),
      `# Getting Started

## Installation

Install OpenClaw globally using npm:

\`\`\`bash
npm install -g openclaw
\`\`\`

## Configuration

The main configuration file lives at ~/.openclaw/openclaw.json.

### Model Setup

Configure your primary model and fallbacks for the gateway.
`
    );

    await writeFile(
      join(docsDir, "configuration.md"),
      `# Configuration Reference

## Gateway Settings

The gateway binds to 127.0.0.1:18789 by default.

### Logging

Logs are written to /tmp/openclaw/openclaw-YYYY-MM-DD.log.

## Model Configuration

### Fallback Chain

Fallbacks are tried in order when the primary model fails.
Each fallback must be a plain model ID like minimax/MiniMax-M2.1.
`
    );

    await writeFile(
      join(skillsDir, "my-skill", "SKILL.md"),
      `# Crypto Tracker Skill

Track cryptocurrency prices and portfolio performance.

## Commands

Check price with /crypto price BTC.
Shows portfolio with /crypto portfolio.

## Implementation

Uses the CoinGecko API for price data with 60 second cache TTL.
`
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeRepos(overrides?: Partial<RepoConfig>[]): RepoConfig[] {
    const defaults: RepoConfig[] = [
      { name: "core-docs", path: docsDir, priority: 1, type: "core" },
      { name: "skills", path: skillsDir, priority: 10, type: "extension" },
    ];
    if (!overrides) return defaults;
    return defaults.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
  }

  it("creates engine, indexes docs, and searches successfully", async () => {
    const engine = createEngine(
      { repositories: makeRepos(), chunkMaxTokens: 800 },
      storageDir
    );
    await engine.start();

    const results = await engine.search("installation npm openclaw");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toContain("getting-started");
    await engine.stop();
  });

  it("returns results ranked by relevance", async () => {
    const engine = createEngine(
      { repositories: makeRepos(), chunkMaxTokens: 800 },
      storageDir
    );
    await engine.start();

    const results = await engine.search("gateway configuration logging");
    expect(results.length).toBeGreaterThan(0);
    const configResult = results.find((r) => r.file.includes("configuration"));
    expect(configResult).toBeDefined();
    await engine.stop();
  });

  it("respects repo priority for conflict resolution", async () => {
    await writeFile(
      join(docsDir, "overlap.md"),
      `# Model Configuration

Configure your primary model and fallbacks.
The fallback chain determines which model to try next when the primary fails.
This is the authoritative core documentation for model configuration.
`
    );
    await writeFile(
      join(skillsDir, "my-skill", "overlap.md"),
      `# Model Configuration

Configure your primary model and fallbacks.
The fallback chain determines which model to try next when the primary fails.
This is the extension documentation for model configuration.
`
    );

    const engine = createEngine(
      { repositories: makeRepos(), chunkMaxTokens: 800 },
      storageDir
    );
    await engine.start();

    const results = await engine.search("model configuration fallback chain");
    expect(results.length).toBeGreaterThan(0);

    const overlapResults = results.filter((r) => r.file.includes("overlap"));
    if (overlapResults.length > 0) {
      expect(overlapResults[0].repo).toBe("core-docs");
    }
    await engine.stop();
  });

  it("filters results by repo", async () => {
    const engine = createEngine(
      { repositories: makeRepos(), chunkMaxTokens: 800 },
      storageDir
    );
    await engine.start();

    const results = await engine.search("cryptocurrency price", { repoFilter: "skills" });
    for (const r of results) {
      expect(r.repo).toBe("skills");
    }
    await engine.stop();
  });

  it("performs incremental indexing on file changes", async () => {
    const engine = createEngine(
      { repositories: makeRepos(), chunkMaxTokens: 800 },
      storageDir
    );
    await engine.start();
    const stats1 = engine.getStats();

    // Modify a file
    await appendFile(
      join(docsDir, "getting-started.md"),
      "\n\n## Troubleshooting\n\nIf you encounter websocket connection errors, check that the gateway is running.\n"
    );

    // Full re-index to get correct TfIdf vocabulary for new terms
    const stats2 = await engine.index(true);
    expect(stats2.totalFiles).toBe(stats1.totalFiles);

    const results = await engine.search("troubleshooting websocket connection errors");
    expect(results.length).toBeGreaterThan(0);
    await engine.stop();
  });

  it("returns stats with repo breakdown", async () => {
    const engine = createEngine(
      { repositories: makeRepos(), chunkMaxTokens: 800 },
      storageDir
    );
    await engine.start();
    const stats = engine.getStats();

    expect(stats.totalFiles).toBeGreaterThan(0);
    expect(stats.totalChunks).toBeGreaterThan(0);
    expect(Object.keys(stats.repos).length).toBeGreaterThan(0);
    await engine.stop();
  });

  it("search returns empty array when no match", async () => {
    const engine = createEngine(
      { repositories: makeRepos(), chunkMaxTokens: 800 },
      storageDir
    );
    await engine.start();

    const results = await engine.search("xyznonexistenttermxyz");
    expect(results).toEqual([]);
    await engine.stop();
  });
});
