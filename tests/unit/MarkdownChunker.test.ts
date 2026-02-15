import { describe, it, expect } from "vitest";
import { chunkMarkdown, type ChunkOptions } from "../../src/indexing/MarkdownChunker.js";
import { createHash } from "node:crypto";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

const defaultOpts: ChunkOptions = {
  maxTokens: 500,
  repo: "test-repo",
  file: "docs/guide.md",
};

describe("MarkdownChunker", () => {
  it("single heading → one chunk", () => {
    const content = "# Introduction\n\nThis is the intro paragraph.";
    const chunks = chunkMarkdown(content, defaultOpts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sectionPath).toBe("# Introduction");
    expect(chunks[0].text).toContain("This is the intro paragraph.");
    expect(chunks[0].repo).toBe("test-repo");
    expect(chunks[0].file).toBe("docs/guide.md");
  });

  it("multiple H1s → multiple chunks", () => {
    const content = "# First\n\nFirst content.\n\n# Second\n\nSecond content.";
    const chunks = chunkMarkdown(content, defaultOpts);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].sectionPath).toBe("# First");
    expect(chunks[0].text).toContain("First content.");
    expect(chunks[1].sectionPath).toBe("# Second");
    expect(chunks[1].text).toContain("Second content.");
  });

  it("nested headings → proper sectionPath hierarchy", () => {
    const content =
      "# Config\n\nTop level.\n\n## Models\n\nModel config.\n\n### Fallbacks\n\nFallback info.";
    const chunks = chunkMarkdown(content, defaultOpts);
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    const configChunk = chunks.find((c) => c.sectionPath === "# Config");
    const modelsChunk = chunks.find(
      (c) => c.sectionPath === "# Config > ## Models"
    );
    const fallbacksChunk = chunks.find(
      (c) => c.sectionPath === "# Config > ## Models > ### Fallbacks"
    );

    expect(configChunk).toBeDefined();
    expect(modelsChunk).toBeDefined();
    expect(fallbacksChunk).toBeDefined();
    expect(fallbacksChunk!.text).toContain("Fallback info.");
  });

  it("long section → splits by paragraphs", () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i + 1} with enough text to take up space. `.repeat(5)
    ).join("\n\n");
    const content = `# LongSection\n\n${paragraphs}`;
    const opts: ChunkOptions = { maxTokens: 100, repo: "test-repo", file: "big.md" };
    const chunks = chunkMarkdown(content, opts);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(opts.maxTokens);
    }
  });

  it("very long paragraph → splits by sentences", () => {
    const longParagraph = Array.from(
      { length: 50 },
      (_, i) => `Sentence number ${i + 1} is quite long and detailed.`
    ).join(" ");
    const content = `# Huge\n\n${longParagraph}`;
    const opts: ChunkOptions = { maxTokens: 50, repo: "test-repo", file: "huge.md" };
    const chunks = chunkMarkdown(content, opts);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(opts.maxTokens);
    }
  });

  it("empty content → empty array", () => {
    expect(chunkMarkdown("", defaultOpts)).toEqual([]);
  });

  it("content with no headings → single chunk with '# (root)' sectionPath", () => {
    const content = "Just some plain text without any headings.";
    const chunks = chunkMarkdown(content, defaultOpts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sectionPath).toBe("# (root)");
    expect(chunks[0].text).toContain("Just some plain text");
  });

  it("token count is calculated correctly", () => {
    const text = "Hello world"; // 11 chars → ceil(11/4) = 3
    const content = `# Test\n\n${text}`;
    const chunks = chunkMarkdown(content, defaultOpts);
    expect(chunks).toHaveLength(1);
    // tokenCount should be ceil(chunk.text.length / 4)
    expect(chunks[0].tokenCount).toBe(Math.ceil(chunks[0].text.length / 4));
  });

  it("chunkId is deterministic (same input → same id)", () => {
    const content = "# Deterministic\n\nSame content every time.";
    const chunks1 = chunkMarkdown(content, defaultOpts);
    const chunks2 = chunkMarkdown(content, defaultOpts);
    expect(chunks1[0].chunkId).toBe(chunks2[0].chunkId);

    // Verify it matches expected SHA256
    const expectedId = sha256("test-repo|docs/guide.md|# Deterministic");
    expect(chunks1[0].chunkId).toBe(expectedId);
  });

  it("hash is SHA256 of chunk text", () => {
    const content = "# HashTest\n\nSome text to hash.";
    const chunks = chunkMarkdown(content, defaultOpts);
    expect(chunks[0].hash).toBe(sha256(chunks[0].text));
  });

  it("preserves code blocks intact (don't split inside ```)", () => {
    const codeBlock = "```typescript\nfunction foo() {\n  return 1;\n}\n```";
    const content = `# Code\n\n${codeBlock}\n\nSome text after.`;
    const chunks = chunkMarkdown(content, defaultOpts);
    // The code block should be in one chunk, not split across chunks
    const chunkWithCode = chunks.find((c) => c.text.includes("function foo()"));
    expect(chunkWithCode).toBeDefined();
    expect(chunkWithCode!.text).toContain("```typescript");
    expect(chunkWithCode!.text).toContain("```");
  });
});
