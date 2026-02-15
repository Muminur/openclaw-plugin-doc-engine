import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoWatcher } from "../../src/watchers/RepoWatcher.js";
import type { RepoConfig } from "../../src/types.js";

let tempDir: string;
let repoDir: string;

function makeRepo(path: string, name = "test-repo"): RepoConfig {
  return { name, path, priority: 1, type: "core" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "repowatcher-test-"));
  repoDir = join(tempDir, "repo");
  await mkdir(repoDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("RepoWatcher", () => {
  it("fires onChange for .md file changes", async () => {
    const changes: Array<{ repo: string; file: string }> = [];
    const watcher = createRepoWatcher({
      repos: [makeRepo(repoDir)],
      debounceMs: 50,
      onFileChange: async (repo, file) => {
        changes.push({ repo, file });
      },
    });

    watcher.start();
    try {
      await sleep(100); // let watcher initialize
      await writeFile(join(repoDir, "test.md"), "hello");
      await sleep(200); // wait for debounce
      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes[0].repo).toBe("test-repo");
      expect(changes[0].file).toContain("test.md");
    } finally {
      watcher.stop();
    }
  });

  it("does NOT fire for non-.md files", async () => {
    const changes: Array<{ repo: string; file: string }> = [];
    const watcher = createRepoWatcher({
      repos: [makeRepo(repoDir)],
      debounceMs: 50,
      onFileChange: async (repo, file) => {
        changes.push({ repo, file });
      },
    });

    watcher.start();
    try {
      await sleep(100);
      await writeFile(join(repoDir, "test.txt"), "hello");
      await writeFile(join(repoDir, "test.js"), "hello");
      await sleep(200);
      expect(changes).toHaveLength(0);
    } finally {
      watcher.stop();
    }
  });

  it("debounces rapid changes", async () => {
    const calls: number[] = [];
    const watcher = createRepoWatcher({
      repos: [makeRepo(repoDir)],
      debounceMs: 150,
      onFileChange: async () => {
        calls.push(Date.now());
      },
    });

    watcher.start();
    try {
      await sleep(100);
      // Rapid writes within debounce window
      await writeFile(join(repoDir, "a.md"), "1");
      await sleep(30);
      await writeFile(join(repoDir, "a.md"), "2");
      await sleep(30);
      await writeFile(join(repoDir, "a.md"), "3");
      await sleep(300); // wait for debounce to fire
      // Should have grouped into fewer calls than 3
      expect(calls.length).toBeLessThanOrEqual(2);
      expect(calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.stop();
    }
  });

  it("stop closes watchers cleanly", async () => {
    const changes: string[] = [];
    const watcher = createRepoWatcher({
      repos: [makeRepo(repoDir)],
      debounceMs: 50,
      onFileChange: async (_repo, file) => {
        changes.push(file);
      },
    });

    watcher.start();
    watcher.stop();
    await sleep(50);
    await writeFile(join(repoDir, "after-stop.md"), "data");
    await sleep(200);
    // No changes should fire after stop
    expect(changes).toHaveLength(0);
  });

  it("handles missing directory gracefully", () => {
    const watcher = createRepoWatcher({
      repos: [makeRepo(join(tempDir, "nonexistent-dir"))],
      debounceMs: 50,
      onFileChange: async () => {},
    });

    // Should not throw
    expect(() => watcher.start()).not.toThrow();
    watcher.stop();
  });
});
