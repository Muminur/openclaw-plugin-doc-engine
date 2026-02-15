/**
 * Language filter for the doc-engine indexing pipeline.
 * Detects and filters non-English content at both file-path and chunk levels.
 */

export interface LanguageFilterConfig {
  englishOnly?: boolean;
}

export interface LanguageFilter {
  shouldSkipFile(filePath: string): boolean;
  shouldSkipChunk(text: string): boolean;
}

/** Known i18n directory segments to skip when englishOnly is true */
const I18N_DIRS = new Set([
  "zh-cn",
  "zh-tw",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "ar",
  "hi",
  "it",
  "nl",
  "pl",
  "tr",
  "vi",
  "th",
  "id",
  "uk",
  "cs",
  "sv",
  "da",
  "fi",
  "nb",
  "el",
  "he",
  "ro",
  "hu",
  "bg",
  "hr",
  "sk",
  "sl",
  "lt",
  "lv",
  "et",
  "ms",
  "fil",
  "bn",
  "ta",
  "te",
  "ml",
  "kn",
  "mr",
  "gu",
  "pa",
  "ur",
  "fa",
  "sw",
]);

/** Threshold: if non-English chars exceed this ratio, skip the chunk */
const NON_ENGLISH_THRESHOLD = 0.3;

/**
 * Count characters that belong to non-Latin scripts.
 * Covers CJK, Arabic, Cyrillic, Devanagari, and other non-Latin ranges.
 * Ignores whitespace, punctuation, digits, and common symbols.
 */
function countNonEnglishChars(text: string): { nonEnglish: number; meaningful: number } {
  let nonEnglish = 0;
  let meaningful = 0;

  for (const char of text) {
    const code = char.codePointAt(0)!;

    // Skip whitespace, basic ASCII punctuation, digits
    if (code <= 0x40) continue; // space, digits, basic punctuation
    if (code >= 0x5b && code <= 0x60) continue; // [ \ ] ^ _ `
    if (code >= 0x7b && code <= 0x7f) continue; // { | } ~ DEL

    // Latin extended (accents like é, ü, ñ) — count as English-friendly
    if (code >= 0x41 && code <= 0x7a) {
      meaningful++;
      continue;
    }
    if (code >= 0xc0 && code <= 0x024f) {
      // Latin Extended-A/B — accented chars
      meaningful++;
      continue;
    }

    // Emoji ranges — skip (don't count as non-English or English)
    if (code >= 0x1f300 && code <= 0x1faff) continue;
    if (code >= 0x2600 && code <= 0x27bf) continue;
    if (code >= 0xfe00 && code <= 0xfe0f) continue; // variation selectors
    if (code >= 0x200d && code <= 0x200d) continue; // ZWJ

    // CJK Unified Ideographs
    if (code >= 0x4e00 && code <= 0x9fff) { nonEnglish++; meaningful++; continue; }
    // CJK Extension A
    if (code >= 0x3400 && code <= 0x4dbf) { nonEnglish++; meaningful++; continue; }
    // CJK Compatibility Ideographs
    if (code >= 0xf900 && code <= 0xfaff) { nonEnglish++; meaningful++; continue; }
    // CJK Symbols and Punctuation
    if (code >= 0x3000 && code <= 0x303f) { nonEnglish++; meaningful++; continue; }
    // Hiragana
    if (code >= 0x3040 && code <= 0x309f) { nonEnglish++; meaningful++; continue; }
    // Katakana
    if (code >= 0x30a0 && code <= 0x30ff) { nonEnglish++; meaningful++; continue; }
    // Hangul Syllables
    if (code >= 0xac00 && code <= 0xd7af) { nonEnglish++; meaningful++; continue; }
    // Hangul Jamo
    if (code >= 0x1100 && code <= 0x11ff) { nonEnglish++; meaningful++; continue; }
    // Arabic
    if (code >= 0x0600 && code <= 0x06ff) { nonEnglish++; meaningful++; continue; }
    // Cyrillic
    if (code >= 0x0400 && code <= 0x04ff) { nonEnglish++; meaningful++; continue; }
    // Devanagari
    if (code >= 0x0900 && code <= 0x097f) { nonEnglish++; meaningful++; continue; }
    // Thai
    if (code >= 0x0e00 && code <= 0x0e7f) { nonEnglish++; meaningful++; continue; }
    // Bengali
    if (code >= 0x0980 && code <= 0x09ff) { nonEnglish++; meaningful++; continue; }
    // Tamil
    if (code >= 0x0b80 && code <= 0x0bff) { nonEnglish++; meaningful++; continue; }
    // Telugu
    if (code >= 0x0c00 && code <= 0x0c7f) { nonEnglish++; meaningful++; continue; }
    // Gujarati
    if (code >= 0x0a80 && code <= 0x0aff) { nonEnglish++; meaningful++; continue; }
    // Gurmukhi (Punjabi)
    if (code >= 0x0a00 && code <= 0x0a7f) { nonEnglish++; meaningful++; continue; }
    // Hebrew
    if (code >= 0x0590 && code <= 0x05ff) { nonEnglish++; meaningful++; continue; }
    // Georgian
    if (code >= 0x10a0 && code <= 0x10ff) { nonEnglish++; meaningful++; continue; }
    // Armenian
    if (code >= 0x0530 && code <= 0x058f) { nonEnglish++; meaningful++; continue; }
    // Fullwidth forms (often CJK punctuation)
    if (code >= 0xff00 && code <= 0xffef) { nonEnglish++; meaningful++; continue; }

    // Everything else: count as meaningful but not non-English
    meaningful++;
  }

  return { nonEnglish, meaningful };
}

export function createLanguageFilter(
  config?: LanguageFilterConfig
): LanguageFilter {
  const englishOnly = config?.englishOnly ?? true;

  return {
    shouldSkipFile(filePath: string): boolean {
      if (!englishOnly) return false;

      // Split path into segments and check each against i18n dirs
      const segments = filePath.toLowerCase().split("/");
      for (const segment of segments) {
        if (I18N_DIRS.has(segment)) return true;
      }
      return false;
    },

    shouldSkipChunk(text: string): boolean {
      if (!englishOnly) return false;

      // Don't filter empty/whitespace-only text
      const trimmed = text.trim();
      if (trimmed.length === 0) return false;

      const { nonEnglish, meaningful } = countNonEnglishChars(trimmed);
      if (meaningful === 0) return false;

      return nonEnglish / meaningful > NON_ENGLISH_THRESHOLD;
    },
  };
}
