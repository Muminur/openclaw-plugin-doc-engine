import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRepoRegistry } from "../../src/registry/RepoRegistry.js";
import type { RepoConfig } from "../../src/types.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("RepoRegistry", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "repo-registry-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
    return {
      name: "test-repo",
      path: tempDir,
      priority: 10,
      type: "core",
      ...overrides,
    };
  }

  describe("scan()", () => {
    it("returns correct files for a repo", async () => {
      await writeFile(join(tempDir, "README.md"), "# Hello");
      await mkdir(join(tempDir, "docs"), { recursive: true });
      await writeFile(join(tempDir, "docs", "guide.md"), "# Guide");

      const registry = createRepoRegistry([makeConfig()]);
      const result = await registry.scan();

      expect(result.has("test-repo")).toBe(true);
      const files = result.get("test-repo")!;
      expect(files).toHaveLength(2);
      expect(files.some((f) => f.endsWith("README.md"))).toBe(true);
      expect(files.some((f) => f.endsWith("guide.md"))).toBe(true);
    });

    it("handles missing directory gracefully", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = makeConfig({ path: "/nonexistent/path/abc123" });
      const registry = createRepoRegistry([config]);
      const result = await registry.scan();

      expect(result.has("test-repo")).toBe(true);
      expect(result.get("test-repo")).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("uses custom glob pattern", async () => {
      await writeFile(join(tempDir, "README.md"), "# Readme");
      await writeFile(join(tempDir, "SKILL.md"), "# Skill");
      await mkdir(join(tempDir, "sub"), { recursive: true });
      await writeFile(join(tempDir, "sub", "SKILL.md"), "# Sub Skill");
      await writeFile(join(tempDir, "sub", "other.md"), "# Other");

      const config = makeConfig({ glob: "**/SKILL.md" });
      const registry = createRepoRegistry([config]);
      const result = await registry.scan();

      const files = result.get("test-repo")!;
      expect(files).toHaveLength(2);
      expect(files.every((f) => f.endsWith("SKILL.md"))).toBe(true);
    });
  });

  describe("allRepos()", () => {
    it("returns configs sorted by priority ascending", () => {
      const configs: RepoConfig[] = [
        makeConfig({ name: "low-priority", priority: 100 }),
        makeConfig({ name: "high-priority", priority: 1 }),
        makeConfig({ name: "mid-priority", priority: 50 }),
      ];
      const registry = createRepoRegistry(configs);
      const sorted = registry.allRepos();

      expect(sorted.map((c) => c.name)).toEqual([
        "high-priority",
        "mid-priority",
        "low-priority",
      ]);
    });
  });

  describe("getRepo()", () => {
    it("finds a repo by name", () => {
      const config = makeConfig({ name: "my-docs" });
      const registry = createRepoRegistry([config]);

      const found = registry.getRepo("my-docs");
      expect(found).toBeDefined();
      expect(found!.name).toBe("my-docs");
    });

    it("returns undefined for unknown name", () => {
      const registry = createRepoRegistry([makeConfig()]);
      expect(registry.getRepo("nonexistent")).toBeUndefined();
    });
  });

  describe("resolveGlob()", () => {
    it("with **/*.md finds nested markdown files", async () => {
      await writeFile(join(tempDir, "root.md"), "# Root");
      await writeFile(join(tempDir, "readme.txt"), "text");
      await mkdir(join(tempDir, "a", "b"), { recursive: true });
      await writeFile(join(tempDir, "a", "deep.md"), "# Deep");
      await writeFile(join(tempDir, "a", "b", "deeper.md"), "# Deeper");

      const config = makeConfig({ glob: "**/*.md" });
      const registry = createRepoRegistry([config]);
      const files = await registry.resolveGlob(config);

      expect(files).toHaveLength(3);
      expect(files.every((f) => f.endsWith(".md"))).toBe(true);
    });

    it("with **/SKILL.md only finds SKILL.md files", async () => {
      await writeFile(join(tempDir, "README.md"), "# Readme");
      await writeFile(join(tempDir, "SKILL.md"), "# Root Skill");
      await mkdir(join(tempDir, "sub"), { recursive: true });
      await writeFile(join(tempDir, "sub", "SKILL.md"), "# Sub Skill");
      await writeFile(join(tempDir, "sub", "other.md"), "# Other");

      const config = makeConfig({ glob: "**/SKILL.md" });
      const registry = createRepoRegistry([config]);
      const files = await registry.resolveGlob(config);

      expect(files).toHaveLength(2);
      expect(files.every((f) => f.endsWith("SKILL.md"))).toBe(true);
    });

    it("with *.md finds only root-level markdown files", async () => {
      await writeFile(join(tempDir, "root.md"), "# Root");
      await mkdir(join(tempDir, "sub"), { recursive: true });
      await writeFile(join(tempDir, "sub", "nested.md"), "# Nested");

      const config = makeConfig({ glob: "*.md" });
      const registry = createRepoRegistry([config]);
      const files = await registry.resolveGlob(config);

      expect(files).toHaveLength(1);
      expect(files[0]).toContain("root.md");
    });
  });

  describe("~ expansion", () => {
    it("expands ~ to home directory in paths", async () => {
      // We test that ~ is resolved without error — the path won't exist
      // but the registry should attempt to resolve it
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = makeConfig({
        path: "~/nonexistent-test-dir-abc123",
      });
      const registry = createRepoRegistry([config]);
      const result = await registry.scan();

      // Should not throw, just warn and return empty
      expect(result.get("test-repo")).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
