import { describe, it, expect } from "vitest";
import { createScanner } from "../../src/security/SecretScanner.js";

describe("SecretScanner", () => {
  const scanner = createScanner();

  describe("clean()", () => {
    it("cleans OpenAI key from text", () => {
      const text = "My key is sk-abcdefghijklmnopqrstuvwxyz1234567890";
      const result = scanner.clean(text);
      expect(result).toBe("My key is [REDACTED]");
      expect(result).not.toContain("sk-");
    });

    it("cleans Google API key", () => {
      const text = "Google key: AIzaSyA1234567890abcdefghijklmnopqrstuv";
      const result = scanner.clean(text);
      expect(result).toBe("Google key: [REDACTED]");
      expect(result).not.toContain("AIza");
    });

    it("cleans GitHub PAT", () => {
      const text = "Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890";
      const result = scanner.clean(text);
      expect(result).toBe("Token: [REDACTED]");
      expect(result).not.toContain("ghp_");
    });

    it("cleans Slack bot token", () => {
      const text = "Slack: xoxb-123-456-abcdef";
      const result = scanner.clean(text);
      expect(result).toBe("Slack: [REDACTED]");
      expect(result).not.toContain("xoxb-");
    });

    it("cleans multiple secrets in one text", () => {
      const text =
        "OpenAI: sk-abcdefghijklmnopqrstuvwxyz1234567890 and GitHub: ghp_abcdefghijklmnopqrstuvwxyz1234567890";
      const result = scanner.clean(text);
      expect(result).toBe("OpenAI: [REDACTED] and GitHub: [REDACTED]");
    });

    it("preserves text without secrets", () => {
      const text = "This is just a normal paragraph with no secrets.";
      expect(scanner.clean(text)).toBe(text);
    });

    it("supports custom patterns", () => {
      const custom = createScanner(["CUSTOM-[A-Z]{10}"]);
      const text = "My custom key: CUSTOM-ABCDEFGHIJ";
      expect(custom.clean(text)).toBe("My custom key: [REDACTED]");
    });
  });

  describe("shouldSkipFile()", () => {
    it("skips .env", () => {
      expect(scanner.shouldSkipFile(".env")).toBe(true);
    });

    it("skips .env.local", () => {
      expect(scanner.shouldSkipFile(".env.local")).toBe(true);
    });

    it("skips .env.production", () => {
      expect(scanner.shouldSkipFile(".env.production")).toBe(true);
    });

    it("skips credentials.json", () => {
      expect(scanner.shouldSkipFile("credentials.json")).toBe(true);
    });

    it("skips auth-profiles.json", () => {
      expect(scanner.shouldSkipFile("auth-profiles.json")).toBe(true);
    });

    it("does not skip normal.md", () => {
      expect(scanner.shouldSkipFile("normal.md")).toBe(false);
    });

    it("skips files with 'secret' in the name", () => {
      expect(scanner.shouldSkipFile("my-secret-config.json")).toBe(true);
    });

    it("skips files with 'token' in the name", () => {
      expect(scanner.shouldSkipFile("api-token.txt")).toBe(true);
    });

    it("does not skip files with 'tokenCount' in the name", () => {
      expect(scanner.shouldSkipFile("tokenCount.ts")).toBe(false);
    });

    it("does not skip files with 'tokenize' in the name", () => {
      expect(scanner.shouldSkipFile("tokenize.ts")).toBe(false);
    });

    it("handles nested paths", () => {
      expect(scanner.shouldSkipFile("config/.env.local")).toBe(true);
      expect(scanner.shouldSkipFile("src/utils/helper.ts")).toBe(false);
    });
  });
});
