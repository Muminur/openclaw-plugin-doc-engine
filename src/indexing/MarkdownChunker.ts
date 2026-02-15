import { createHash } from "node:crypto";
import type { DocChunk } from "../types.js";

export interface ChunkOptions {
  maxTokens: number;
  repo: string;
  file: string;
}

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Section {
  level: number;
  heading: string;
  parentPath: string[];
  text: string;
}

function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  const headingStack: { level: number; heading: string }[] = [];

  let currentText = "";
  let hasHeading = false;

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      // Save previous section
      if (hasHeading || currentText.trim()) {
        sections.push({
          level: hasHeading ? headingStack[headingStack.length - 1].level : 0,
          heading: hasHeading
            ? headingStack[headingStack.length - 1].heading
            : "(root)",
          parentPath: hasHeading
            ? headingStack.slice(0, -1).map((h) => `${"#".repeat(h.level)} ${h.heading}`)
            : [],
          text: currentText.trim(),
        });
      }

      const level = match[1].length;
      const heading = match[2];

      // Pop headings of same or lower level
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop();
      }
      headingStack.push({ level, heading });
      currentText = "";
      hasHeading = true;
    } else {
      currentText += line + "\n";
    }
  }

  // Save last section
  if (hasHeading || currentText.trim()) {
    sections.push({
      level: hasHeading ? headingStack[headingStack.length - 1].level : 0,
      heading: hasHeading
        ? headingStack[headingStack.length - 1].heading
        : "(root)",
      parentPath: hasHeading
        ? headingStack.slice(0, -1).map((h) => `${"#".repeat(h.level)} ${h.heading}`)
        : [],
      text: currentText.trim(),
    });
  }

  return sections;
}

function buildSectionPath(section: Section): string {
  const selfLabel =
    section.heading === "(root)"
      ? "# (root)"
      : `${"#".repeat(section.level)} ${section.heading}`;
  if (section.parentPath.length === 0) return selfLabel;
  return [...section.parentPath, selfLabel].join(" > ");
}

function splitByParagraphs(text: string): string[] {
  // Don't split inside code blocks
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match: RegExpExecArray | null;

  const codeBlocks: { start: number; end: number; text: string }[] = [];
  while ((match = codeBlockRegex.exec(text)) !== null) {
    codeBlocks.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }

  if (codeBlocks.length === 0) {
    return text.split(/\n\n+/).filter((p) => p.trim());
  }

  // Split only outside code blocks
  const parts: string[] = [];
  let cursor = 0;
  for (const block of codeBlocks) {
    const before = text.slice(cursor, block.start);
    if (before.trim()) {
      parts.push(...before.split(/\n\n+/).filter((p) => p.trim()));
    }
    parts.push(block.text);
    cursor = block.end;
  }
  const after = text.slice(cursor);
  if (after.trim()) {
    parts.push(...after.split(/\n\n+/).filter((p) => p.trim()));
  }

  return parts;
}

function splitBySentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim());
}

function makeChunk(
  text: string,
  sectionPath: string,
  repo: string,
  file: string
): DocChunk {
  return {
    chunkId: hashString(`${repo}|${file}|${sectionPath}`),
    repo,
    file,
    sectionPath,
    text,
    hash: hashString(text),
    tokenCount: estimateTokens(text),
  };
}

function splitToFit(
  text: string,
  maxTokens: number,
  sectionPath: string,
  repo: string,
  file: string
): DocChunk[] {
  if (estimateTokens(text) <= maxTokens) {
    return [makeChunk(text, sectionPath, repo, file)];
  }

  const paragraphs = splitByParagraphs(text);
  const chunks: DocChunk[] = [];
  let buffer = "";
  let partIndex = 0;

  for (const para of paragraphs) {
    const combined = buffer ? `${buffer}\n\n${para}` : para;
    if (estimateTokens(combined) <= maxTokens) {
      buffer = combined;
    } else {
      if (buffer) {
        chunks.push(
          makeChunk(
            buffer,
            partIndex === 0 ? sectionPath : `${sectionPath} [part ${partIndex + 1}]`,
            repo,
            file
          )
        );
        partIndex++;
      }

      if (estimateTokens(para) > maxTokens) {
        const sentences = splitBySentences(para);
        let sentenceBuffer = "";
        for (const sentence of sentences) {
          const sentCombined = sentenceBuffer
            ? `${sentenceBuffer} ${sentence}`
            : sentence;
          if (estimateTokens(sentCombined) <= maxTokens) {
            sentenceBuffer = sentCombined;
          } else {
            if (sentenceBuffer) {
              chunks.push(
                makeChunk(
                  sentenceBuffer,
                  `${sectionPath} [part ${partIndex + 1}]`,
                  repo,
                  file
                )
              );
              partIndex++;
            }
            sentenceBuffer = sentence;
          }
        }
        buffer = sentenceBuffer;
      } else {
        buffer = para;
      }
    }
  }

  if (buffer.trim()) {
    chunks.push(
      makeChunk(
        buffer,
        partIndex === 0 ? sectionPath : `${sectionPath} [part ${partIndex + 1}]`,
        repo,
        file
      )
    );
  }

  return chunks;
}

export function chunkMarkdown(content: string, opts: ChunkOptions): DocChunk[] {
  if (!content.trim()) return [];

  const sections = parseSections(content);
  const chunks: DocChunk[] = [];

  for (const section of sections) {
    if (!section.text.trim()) continue;
    const sectionPath = buildSectionPath(section);
    chunks.push(
      ...splitToFit(section.text, opts.maxTokens, sectionPath, opts.repo, opts.file)
    );
  }

  return chunks;
}
