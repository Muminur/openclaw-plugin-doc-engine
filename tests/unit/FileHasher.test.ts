import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashString,
  hashFile,
  diffHashes,
  loadHashes,
  saveHashes,
} from "../../src/indexing/FileHasher.js";
import type { FileHashRecord } from "../../src/types.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "filehasher-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("hashString", () => {
  it("produces consistent SHA256 hex digest", () => {
    const hash1 = hashString("hello world");
    const hash2 = hashString("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different inputs", () => {
    expect(hashString("foo")).not.toBe(hashString("bar"));
  });
});

describe("hashFile", () => {
  it("reads and hashes a real temp file", async () => {
    const filePath = join(tempDir, "test.txt");
    await writeFile(filePath, "hello world", "utf-8");
    const hash = await hashFile(filePath);
    expect(hash).toBe(hashString("hello world"));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("diffHashes", () => {
  it("detects added files", () => {
    const stored: Record<string, FileHashRecord> = {};
    const current: Record<string, string> = { "new.md": "abc123" };
    const diff = diffHashes(stored, current);
    expect(diff.added).toEqual(["new.md"]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it("detects changed files", () => {
    const stored: Record<string, FileHashRecord> = {
      "doc.md": { path: "doc.md", hash: "old", repo: "r", lastIndexed: "" },
    };
    const current: Record<string, string> = { "doc.md": "new" };
    const diff = diffHashes(stored, current);
    expect(diff.changed).toEqual(["doc.md"]);
    expect(diff.added).toEqual([]);
  });

  it("detects removed files", () => {
    const stored: Record<string, FileHashRecord> = {
      "gone.md": { path: "gone.md", hash: "x", repo: "r", lastIndexed: "" },
    };
    const current: Record<string, string> = {};
    const diff = diffHashes(stored, current);
    expect(diff.removed).toEqual(["gone.md"]);
  });

  it("detects unchanged files", () => {
    const stored: Record<string, FileHashRecord> = {
      "same.md": { path: "same.md", hash: "aaa", repo: "r", lastIndexed: "" },
    };
    const current: Record<string, string> = { "same.md": "aaa" };
    const diff = diffHashes(stored, current);
    expect(diff.unchanged).toEqual(["same.md"]);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});

describe("loadHashes", () => {
  it("returns empty object for missing file", async () => {
    const result = await loadHashes(join(tempDir, "nonexistent.json"));
    expect(result).toEqual({});
  });

  it("reads valid JSON", async () => {
    const storagePath = join(tempDir, "hashes.json");
    const data: Record<string, FileHashRecord> = {
      "f.md": { path: "f.md", hash: "h1", repo: "r1", lastIndexed: "2026-01-01" },
    };
    await writeFile(storagePath, JSON.stringify(data), "utf-8");
    const result = await loadHashes(storagePath);
    expect(result).toEqual(data);
  });
});

describe("saveHashes", () => {
  it("creates file and can round-trip", async () => {
    const storagePath = join(tempDir, "sub", "deep", "hashes.json");
    const data: Record<string, FileHashRecord> = {
      "a.md": { path: "a.md", hash: "abc", repo: "main", lastIndexed: "2026-02-15" },
    };
    await saveHashes(storagePath, data);
    const raw = await readFile(storagePath, "utf-8");
    expect(JSON.parse(raw)).toEqual(data);

    // Round-trip via loadHashes
    const loaded = await loadHashes(storagePath);
    expect(loaded).toEqual(data);
  });
});
