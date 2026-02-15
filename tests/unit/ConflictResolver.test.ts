import { describe, it, expect } from "vitest";
import { resolveConflicts } from "../../src/retrieval/ConflictResolver.js";
import type { SearchResult } from "../../src/types.js";

function makeResult(overrides: Partial<SearchResult> & { text: string }): SearchResult {
  return {
    chunkId: overrides.chunkId ?? "chunk-1",
    repo: overrides.repo ?? "repo",
    file: overrides.file ?? "file.md",
    sectionPath: overrides.sectionPath ?? "# Test",
    text: overrides.text,
    hash: overrides.hash ?? "hash",
    tokenCount: overrides.tokenCount ?? Math.ceil(overrides.text.length / 4),
    score: overrides.score ?? 0.5,
    repoType: overrides.repoType ?? "core",
    repoPriority: overrides.repoPriority ?? 1,
  };
}

describe("ConflictResolver", () => {
  it("returns results sorted by score DESC", () => {
    const results: SearchResult[] = [
      makeResult({ text: "alpha content here", score: 0.3, chunkId: "a" }),
      makeResult({ text: "beta content here", score: 0.9, chunkId: "b" }),
      makeResult({ text: "gamma content here", score: 0.6, chunkId: "c" }),
    ];
    const resolved = resolveConflicts(results);
    expect(resolved[0].score).toBe(0.9);
    expect(resolved[1].score).toBe(0.6);
    expect(resolved[2].score).toBe(0.3);
  });

  it("tiebreaks equal scores by priority ASC (lower = better)", () => {
    const results: SearchResult[] = [
      makeResult({ text: "first unique text", score: 0.8, repoPriority: 5, chunkId: "a" }),
      makeResult({ text: "second unique text", score: 0.8, repoPriority: 1, chunkId: "b" }),
    ];
    const resolved = resolveConflicts(results);
    expect(resolved[0].repoPriority).toBe(1);
    expect(resolved[1].repoPriority).toBe(5);
  });

  it("removes duplicates with >70% text overlap", () => {
    const baseWords = "the quick brown fox jumps over the lazy dog and runs away fast";
    // >70% overlap — almost identical
    const nearDup = "the quick brown fox jumps over the lazy dog and runs away quickly";
    const results: SearchResult[] = [
      makeResult({ text: baseWords, score: 0.9, repoPriority: 1, chunkId: "a" }),
      makeResult({ text: nearDup, score: 0.8, repoPriority: 2, chunkId: "b" }),
    ];
    const resolved = resolveConflicts(results);
    expect(resolved).toHaveLength(1);
    // Keeps higher priority (lower number)
    expect(resolved[0].repoPriority).toBe(1);
  });

  it("keeps both results when overlap is below 70%", () => {
    const text1 = "the quick brown fox jumps over the lazy dog";
    const text2 = "a completely different sentence about cats and mice playing";
    const results: SearchResult[] = [
      makeResult({ text: text1, score: 0.9, chunkId: "a" }),
      makeResult({ text: text2, score: 0.8, chunkId: "b" }),
    ];
    const resolved = resolveConflicts(results);
    expect(resolved).toHaveLength(2);
  });

  it("when duplicates found, keeps higher priority (lower number)", () => {
    const text = "identical content for both chunks exactly the same words here";
    const results: SearchResult[] = [
      makeResult({ text, score: 0.7, repoPriority: 10, chunkId: "a" }),
      makeResult({ text, score: 0.9, repoPriority: 2, chunkId: "b" }),
    ];
    const resolved = resolveConflicts(results);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].repoPriority).toBe(2);
  });

  it("handles empty input", () => {
    expect(resolveConflicts([])).toEqual([]);
  });

  it("handles single result", () => {
    const results = [makeResult({ text: "only one result here", chunkId: "a" })];
    const resolved = resolveConflicts(results);
    expect(resolved).toHaveLength(1);
  });

  it("deduplicates across three overlapping results", () => {
    const base = "common shared words between all three chunks appear here often enough";
    const results: SearchResult[] = [
      makeResult({ text: base, score: 0.9, repoPriority: 3, chunkId: "a" }),
      makeResult({ text: base + " extra", score: 0.8, repoPriority: 1, chunkId: "b" }),
      makeResult({ text: base + " more", score: 0.7, repoPriority: 2, chunkId: "c" }),
    ];
    const resolved = resolveConflicts(results);
    // All three overlap >70%, keep the one with best priority
    expect(resolved).toHaveLength(1);
    expect(resolved[0].repoPriority).toBe(1);
  });
});
