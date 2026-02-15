const DEFAULT_PATTERNS = [
  "sk-[a-zA-Z0-9]{20,}",
  "AIza[a-zA-Z0-9_\\-]{35}",
  "ghp_[a-zA-Z0-9]{36}",
  "xoxb-[a-zA-Z0-9\\-]+",
];

export interface SecretScanner {
  clean(text: string): string;
  shouldSkipFile(filePath: string): boolean;
}

export function createScanner(patterns?: string[]): SecretScanner {
  const regexPatterns = (patterns ?? DEFAULT_PATTERNS).map(
    (p) => new RegExp(p, "g")
  );

  return {
    clean(text: string): string {
      let result = text;
      for (const re of regexPatterns) {
        re.lastIndex = 0;
        result = result.replace(re, "[REDACTED]");
      }
      return result;
    },

    shouldSkipFile(filePath: string): boolean {
      const basename = filePath.split("/").pop() ?? filePath;

      // .env variants
      if (/^\.env($|\.)/.test(basename)) return true;

      // credentials.json, auth-profiles.json
      if (basename === "credentials.json" || basename === "auth-profiles.json")
        return true;

      // Files with "secret" in the name
      if (/secret/i.test(basename)) return true;

      // Files with "token" in the name, but not tokenCount or tokenize
      if (/token/i.test(basename) && !/token(count|ize)/i.test(basename))
        return true;

      return false;
    },
  };
}
