import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEngine } from "../../src/engine.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("DocEngine integration", () => {
  let tmpDir: string;
  let repoDir: string;
  let storageDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "doc-engine-test-"));
    repoDir = join(tmpDir, "docs");
    storageDir = join(tmpDir, "storage");
    await mkdir(repoDir, { recursive: true });
    await mkdir(storageDir, { recursive: true });

    // Create sample markdown files
    await writeFile(
      join(repoDir, "config.md"),
      "# Configuration\n\nThe gateway configuration lives in openclaw.json.\n\n## Models\n\nConfigure models with primary and fallback fields.\n\n### Fallbacks\n\nFallbacks are tried in order when the primary model fails.\n"
    );
    await writeFile(
      join(repoDir, "installation.md"),
      "# Installation\n\nInstall via npm: `npm install -g openclaw`.\n\n## Requirements\n\nNode.js 20+ is required.\n"
    );
    await writeFile(
      join(repoDir, "troubleshooting.md"),
      "# Troubleshooting\n\nCommon issues and fixes.\n\n## Gateway Errors\n\nCheck the logs at /tmp/openclaw/.\n"
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("engine.start() indexes files", async () => {
    const engine = createEngine(
      {
        repositories: [
          { name: "test-docs", path: repoDir, priority: 1, type: "core" },
        ],
        watchEnabled: false,
      },
      storageDir
    );

    await engine.start();
    const stats = engine.getStats();
    expect(stats.totalFiles).toBeGreaterThan(0);
    expect(stats.totalChunks).toBeGreaterThan(0);
    await engine.stop();
  });

  it("engine.search() returns relevant results", async () => {
    const engine = createEngine(
      {
        repositories: [
          { name: "test-docs", path: repoDir, priority: 1, type: "core" },
        ],
        watchEnabled: false,
      },
      storageDir
    );

    await engine.start();
    const results = await engine.search("configuration models");
    expect(results.length).toBeGreaterThan(0);
    // Results should include config-related content
    const hasConfigContent = results.some(
      (r) => r.text.includes("configuration") || r.text.includes("models") || r.text.includes("Configure")
    );
    expect(hasConfigContent).toBe(true);
    await engine.stop();
  });

  it("engine.index(true) does full rebuild", async () => {
    const engine = createEngine(
      {
        repositories: [
          { name: "test-docs", path: repoDir, priority: 1, type: "core" },
        ],
        watchEnabled: false,
      },
      storageDir
    );

    await engine.start();
    const stats1 = engine.getStats();

    // Full rebuild should produce same or similar stats
    const stats2 = await engine.index(true);
    expect(stats2.totalFiles).toBe(stats1.totalFiles);
    expect(stats2.totalChunks).toBeGreaterThan(0);
    await engine.stop();
  });

  it("engine.getStats() returns correct counts", async () => {
    const engine = createEngine(
      {
        repositories: [
          { name: "test-docs", path: repoDir, priority: 1, type: "core" },
        ],
        watchEnabled: false,
      },
      storageDir
    );

    await engine.start();
    const stats = engine.getStats();
    expect(stats).toHaveProperty("totalChunks");
    expect(stats).toHaveProperty("totalFiles");
    expect(stats).toHaveProperty("repos");
    expect(stats).toHaveProperty("storageBytes");
    expect(stats.totalFiles).toBe(3); // config.md, installation.md, troubleshooting.md
    expect(stats.repos["test-docs"]).toBeDefined();
    expect(stats.repos["test-docs"].files).toBe(3);
    await engine.stop();
  });

  it("engine.stop() is clean", async () => {
    const engine = createEngine(
      {
        repositories: [
          { name: "test-docs", path: repoDir, priority: 1, type: "core" },
        ],
        watchEnabled: false,
      },
      storageDir
    );

    await engine.start();
    // stop should not throw
    await expect(engine.stop()).resolves.toBeUndefined();
  });

  it("engine persists state across instances", async () => {
    const config = {
      repositories: [
        { name: "test-docs", path: repoDir, priority: 1, type: "core" as const },
      ],
      watchEnabled: false,
    };

    // First instance — indexes and saves
    const engine1 = createEngine(config, storageDir);
    await engine1.start();
    const stats1 = engine1.getStats();
    expect(stats1.totalChunks).toBeGreaterThan(0);
    await engine1.stop();

    // Second instance — loads persisted state
    const engine2 = createEngine(config, storageDir);
    await engine2.start();
    const stats2 = engine2.getStats();
    // Should have same number of chunks (loaded + no changes = no reprocessing)
    expect(stats2.totalFiles).toBe(stats1.totalFiles);
    await engine2.stop();
  });
});
