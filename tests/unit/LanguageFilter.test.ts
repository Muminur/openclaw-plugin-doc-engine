import { describe, it, expect } from "vitest";
import {
  createLanguageFilter,
  type LanguageFilter,
} from "../../src/indexing/LanguageFilter.js";

describe("LanguageFilter", () => {
  let filter: LanguageFilter;

  describe("with englishOnly=true (default)", () => {
    beforeEach(() => {
      filter = createLanguageFilter({ englishOnly: true });
    });

    describe("shouldSkipFile()", () => {
      it("skips zh-CN directory files", () => {
        expect(filter.shouldSkipFile("zh-CN/getting-started.md")).toBe(true);
        expect(filter.shouldSkipFile("docs/zh-CN/config.md")).toBe(true);
      });

      it("skips ja directory files", () => {
        expect(filter.shouldSkipFile("ja/overview.md")).toBe(true);
        expect(filter.shouldSkipFile("docs/ja/setup.md")).toBe(true);
      });

      it("skips ko directory files", () => {
        expect(filter.shouldSkipFile("ko/guide.md")).toBe(true);
      });

      it("skips fr directory files", () => {
        expect(filter.shouldSkipFile("fr/intro.md")).toBe(true);
      });

      it("skips de directory files", () => {
        expect(filter.shouldSkipFile("de/config.md")).toBe(true);
      });

      it("skips es directory files", () => {
        expect(filter.shouldSkipFile("es/readme.md")).toBe(true);
      });

      it("skips pt directory files", () => {
        expect(filter.shouldSkipFile("pt/guide.md")).toBe(true);
      });

      it("skips ru directory files", () => {
        expect(filter.shouldSkipFile("ru/overview.md")).toBe(true);
      });

      it("skips ar directory files", () => {
        expect(filter.shouldSkipFile("ar/setup.md")).toBe(true);
      });

      it("skips hi directory files", () => {
        expect(filter.shouldSkipFile("hi/guide.md")).toBe(true);
      });

      it("skips zh-TW directory files", () => {
        expect(filter.shouldSkipFile("zh-TW/guide.md")).toBe(true);
      });

      it("skips it directory files", () => {
        expect(filter.shouldSkipFile("it/guide.md")).toBe(true);
      });

      it("does NOT skip en directory files", () => {
        expect(filter.shouldSkipFile("en/getting-started.md")).toBe(false);
      });

      it("does NOT skip root-level English files", () => {
        expect(filter.shouldSkipFile("getting-started.md")).toBe(false);
        expect(filter.shouldSkipFile("cli/commands.md")).toBe(false);
      });

      it("does NOT skip files with locale-like names that are not directories", () => {
        expect(filter.shouldSkipFile("zh-CN-notes.md")).toBe(false);
      });

      it("handles deeply nested i18n paths", () => {
        expect(filter.shouldSkipFile("docs/translations/zh-CN/deep/file.md")).toBe(true);
      });
    });

    describe("shouldSkipChunk()", () => {
      it("filters pure Chinese text", () => {
        const chineseText = "这是一段中文文本，用于测试语言过滤器的功能。";
        expect(filter.shouldSkipChunk(chineseText)).toBe(true);
      });

      it("filters pure Japanese text", () => {
        const japaneseText = "これはテスト用の日本語テキストです。";
        expect(filter.shouldSkipChunk(japaneseText)).toBe(true);
      });

      it("filters pure Korean text", () => {
        const koreanText = "이것은 테스트를 위한 한국어 텍스트입니다.";
        expect(filter.shouldSkipChunk(koreanText)).toBe(true);
      });

      it("passes pure English text", () => {
        const englishText = "This is a plain English paragraph about OpenClaw configuration and setup.";
        expect(filter.shouldSkipChunk(englishText)).toBe(false);
      });

      it("passes English with code blocks", () => {
        const codeText = "Use the following config:\n```json\n{\"key\": \"value\"}\n```\nThis sets the default.";
        expect(filter.shouldSkipChunk(codeText)).toBe(false);
      });

      it("passes English with emoji", () => {
        const emojiText = "Great job! 🎉 The deployment was successful 🚀 and everything is working.";
        expect(filter.shouldSkipChunk(emojiText)).toBe(false);
      });

      it("passes English with accented characters", () => {
        const accentText = "The contributor José García and François Müller helped with the résumé feature.";
        expect(filter.shouldSkipChunk(accentText)).toBe(false);
      });

      it("filters text with >30% CJK characters (mixed English/Chinese)", () => {
        // 14 CJK chars vs ~25 Latin chars = ~36% non-English
        const mixedText = "Hello world 你好世界这是一个测试文本用于检测 end";
        expect(filter.shouldSkipChunk(mixedText)).toBe(true);
      });

      it("passes text with <30% CJK characters (mostly English)", () => {
        const mostlyEnglish = "This is a long English paragraph about configuration and setup for the gateway. 你好";
        expect(filter.shouldSkipChunk(mostlyEnglish)).toBe(false);
      });

      it("passes empty text", () => {
        expect(filter.shouldSkipChunk("")).toBe(false);
      });

      it("passes whitespace-only text", () => {
        expect(filter.shouldSkipChunk("   \n\t  ")).toBe(false);
      });

      it("filters Arabic text", () => {
        const arabicText = "هذا نص تجريبي باللغة العربية لاختبار مرشح اللغة.";
        expect(filter.shouldSkipChunk(arabicText)).toBe(true);
      });

      it("filters Cyrillic (Russian) text", () => {
        const russianText = "Это тестовый текст на русском языке для проверки фильтра.";
        expect(filter.shouldSkipChunk(russianText)).toBe(true);
      });

      it("filters Devanagari (Hindi) text", () => {
        const hindiText = "यह एक परीक्षण पाठ है जो भाषा फ़िल्टर की जांच करता है।";
        expect(filter.shouldSkipChunk(hindiText)).toBe(true);
      });
    });
  });

  describe("with englishOnly=false", () => {
    beforeEach(() => {
      filter = createLanguageFilter({ englishOnly: false });
    });

    it("does NOT skip zh-CN directory files", () => {
      expect(filter.shouldSkipFile("zh-CN/getting-started.md")).toBe(false);
    });

    it("does NOT skip ja directory files", () => {
      expect(filter.shouldSkipFile("ja/overview.md")).toBe(false);
    });

    it("does NOT filter Chinese text chunks", () => {
      const chineseText = "这是一段中文文本，用于测试语言过滤器的功能。";
      expect(filter.shouldSkipChunk(chineseText)).toBe(false);
    });

    it("does NOT filter Korean text chunks", () => {
      const koreanText = "이것은 테스트를 위한 한국어 텍스트입니다.";
      expect(filter.shouldSkipChunk(koreanText)).toBe(false);
    });

    it("still passes English text", () => {
      const englishText = "This is plain English text.";
      expect(filter.shouldSkipChunk(englishText)).toBe(false);
    });
  });

  describe("default config", () => {
    it("defaults to englishOnly=true when no config provided", () => {
      const defaultFilter = createLanguageFilter();
      expect(defaultFilter.shouldSkipFile("zh-CN/test.md")).toBe(true);
      expect(defaultFilter.shouldSkipChunk("这是中文")).toBe(true);
    });
  });
});
