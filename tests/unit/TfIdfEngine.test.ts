import { describe, it, expect, beforeEach } from "vitest";
import { createTfIdfEngine } from "../../src/embeddings/TfIdfEngine.js";

describe("TfIdfEngine", () => {
  const docs = [
    "The quick brown fox jumps over the lazy dog",
    "A brown dog chased the fox across the field",
    "Machine learning models process natural language",
  ];

  let engine: ReturnType<typeof createTfIdfEngine>;

  beforeEach(() => {
    engine = createTfIdfEngine();
    engine.fit(docs);
  });

  describe("fit", () => {
    it("builds vocabulary from multiple docs", () => {
      expect(engine.dimensions).toBeGreaterThan(0);
    });

    it("filters stopwords from vocabulary", () => {
      // "the", "a", "over" are stopwords — should not appear in vocab
      const serialized = engine.serialize() as { vocabulary: string[] };
      expect(serialized.vocabulary).not.toContain("the");
      expect(serialized.vocabulary).not.toContain("a");
      expect(serialized.vocabulary).not.toContain("over");
    });

    it("uses case-insensitive tokenization", () => {
      const e = createTfIdfEngine();
      e.fit(["Hello World", "hello again"]);
      const serialized = e.serialize() as { vocabulary: string[] };
      // "hello" should appear once, not "Hello" and "hello" separately
      const hellos = serialized.vocabulary.filter((w: string) => w.toLowerCase() === "hello");
      expect(hellos).toHaveLength(1);
      expect(hellos[0]).toBe("hello");
    });
  });

  describe("embed", () => {
    it("returns vector of correct dimensions", () => {
      const vec = engine.embed("quick fox");
      expect(vec).toHaveLength(engine.dimensions);
    });

    it("has non-zero values for fitted document terms", () => {
      const vec = engine.embed("quick brown fox");
      const nonZero = vec.filter((v) => v !== 0);
      expect(nonZero.length).toBeGreaterThan(0);
    });

    it("returns all zeros for completely unknown text", () => {
      const vec = engine.embed("xyzzy plugh");
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it("returns sparse vector for text with only stopwords", () => {
      const vec = engine.embed("the a an is are");
      expect(vec.every((v) => v === 0)).toBe(true);
    });
  });

  describe("embedBatch", () => {
    it("returns correct number of vectors", () => {
      const vecs = engine.embedBatch(["fox", "dog", "machine"]);
      expect(vecs).toHaveLength(3);
      vecs.forEach((v) => expect(v).toHaveLength(engine.dimensions));
    });
  });

  describe("TF-IDF math correctness", () => {
    it("computes correct TF-IDF for known inputs", () => {
      const e = createTfIdfEngine();
      // Two documents, no stopwords involved
      // doc0: "alpha beta alpha" — alpha appears 2x, beta 1x, total 3
      // doc1: "beta gamma gamma gamma" — beta 1x, gamma 3x, total 4
      e.fit(["alpha beta alpha", "beta gamma gamma gamma"]);

      const serialized = e.serialize() as { vocabulary: string[] };
      const vocab = serialized.vocabulary;
      // N = 2 docs
      // df(alpha) = 1 → IDF = log(2/1)
      // df(beta) = 2 → IDF = log(2/2) = 0
      // df(gamma) = 1 → IDF = log(2/1)

      const vec0 = e.embed("alpha beta alpha");
      const idxAlpha = vocab.indexOf("alpha");
      const idxBeta = vocab.indexOf("beta");
      const idxGamma = vocab.indexOf("gamma");

      // TF(alpha, doc0) = 2/3, IDF(alpha) = log(2) ≈ 0.6931
      // TF-IDF(alpha) = (2/3) * log(2)
      expect(vec0[idxAlpha]).toBeCloseTo((2 / 3) * Math.log(2), 4);

      // TF(beta, doc0) = 1/3, IDF(beta) = log(1) = 0
      // TF-IDF(beta) = 0
      expect(vec0[idxBeta]).toBeCloseTo(0, 4);

      // gamma not in doc0
      expect(vec0[idxGamma]).toBe(0);

      const vec1 = e.embed("beta gamma gamma gamma");
      // TF(gamma, doc1) = 3/4, IDF(gamma) = log(2)
      expect(vec1[idxGamma]).toBeCloseTo((3 / 4) * Math.log(2), 4);
    });
  });

  describe("serialize / deserialize", () => {
    it("round-trips correctly", () => {
      const original = engine.embed("quick brown fox");
      const data = engine.serialize();

      const restored = createTfIdfEngine();
      restored.deserialize(data);

      expect(restored.dimensions).toBe(engine.dimensions);
      const restoredVec = restored.embed("quick brown fox");
      expect(restoredVec).toEqual(original);
    });

    it("preserves vocabulary and IDF weights", () => {
      const data = engine.serialize() as {
        vocabulary: string[];
        idf: Record<string, number>;
        docCount: number;
      };
      expect(Array.isArray(data.vocabulary)).toBe(true);
      expect(data.vocabulary.length).toBe(engine.dimensions);
      expect(typeof data.idf).toBe("object");
      expect(typeof data.docCount).toBe("number");
    });
  });
});
