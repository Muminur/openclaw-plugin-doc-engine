import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../../src/embeddings/Similarity.js";

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("returns -1.0 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1.0);
  });

  it("returns 0.0 when one vector is zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0.0 when both vectors are zero", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("throws for vectors of different lengths", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  it("computes correct value for known vectors", () => {
    // a = [1, 0, -1], b = [0, 1, 0]
    // dot = 0, so similarity = 0
    expect(cosineSimilarity([1, 0, -1], [0, 1, 0])).toBeCloseTo(0.0);

    // a = [3, 4], b = [4, 3]
    // dot = 12+12 = 24, |a| = 5, |b| = 5, sim = 24/25 = 0.96
    expect(cosineSimilarity([3, 4], [4, 3])).toBeCloseTo(0.96);
  });
});
