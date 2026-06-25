/**
 * Integration Tests: Secret Scanner - Cloudflare Workers Edition
 * Hades Army v0.9.0
 *
 * Section 10: Testing & Stability
 *
 * Tests the pre-PR secret scanner that blocks PRs containing secrets.
 */

import { describe, it, expect } from "vitest";
import { RepositorySecretScanner } from "../../src/security/repo-secret-scanner";

describe("Repository Secret Scanner Integration", () => {
  let scanner: RepositorySecretScanner;

  beforeEach(() => {
    scanner = new RepositorySecretScanner();
  });

  function makeFile(path: string, content: string) {
    return [{ path, content, status: "added" as const }];
  }

  describe("Detection", () => {
    it("should detect AWS Access Key IDs", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("src/config.ts", `const key = "AKIAIOSFODNN7EXAMPLE";`),
      );
      expect(result.findings.some((f) => f.ruleName === "AWS Access Key ID")).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it("should detect GitHub personal access tokens", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("config.yml", `github_token: ghp_1234567890abcdefghijklmnopqrstuvwxyz1234`),
      );
      expect(result.findings.some((f) => f.ruleName === "GitHub Personal Access Token")).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it("should detect Google API keys", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("config.ts", `const apiKey = "AIzaSyD-1234567890abcdefghijklmnopqrstuvw";`),
      );
      expect(result.findings.some((f) => f.ruleName === "Google API Key")).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it("should detect OpenAI API keys", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("config.ts", `const openai = "sk-1234567890abcdefghijklmnopqrstuvwxyz";`),
      );
      expect(result.findings.some((f) => f.ruleName === "OpenAI API Key")).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it("should detect OpenRouter API keys", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("config.ts", `const or = "sk-or-v1-1234567890abcdefghijklmnopqrstuvwxyz1234567890";`),
      );
      expect(result.findings.some((f) => f.ruleName === "OpenRouter API Key")).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it("should detect Telegram bot tokens", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("config.ts", `const token = "123456789:AAH_abcdefGHIjklmNOPqrstUVWxyz1234567";`),
      );
      expect(result.findings.some((f) => f.ruleName === "Telegram Bot Token")).toBe(true);
      expect(result.blocked).toBe(true);
    });

    it("should detect private key blocks", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("id_rsa", `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...`),
      );
      expect(result.findings.some((f) => f.ruleName === "Private Key Block")).toBe(true);
      expect(result.blocked).toBe(true);
    });
  });

  describe("Blocking", () => {
    it("should block PR when critical finding detected", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("config.ts", `const key = "AKIAIOSFODNN7EXAMPLE";`),
      );
      expect(result.blocked).toBe(true);
    });

    it("should NOT block PR for clean files", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("src/index.ts", `export function add(a: number, b: number) { return a + b; }`),
      );
      expect(result.blocked).toBe(false);
      expect(result.findings).toEqual([]);
    });
  });

  describe("Forbidden paths", () => {
    it("should block .env files", () => {
      const result = scanner.scanPatch("", makeFile(".env", `DATABASE_URL=postgres://...`));
      expect(result.blocked).toBe(true);
      expect(result.findings.some((f) => f.ruleName === "Forbidden Path")).toBe(true);
    });

    it("should block .env.local files", () => {
      const result = scanner.scanPatch("", makeFile(".env.local", `KEY=value`));
      expect(result.blocked).toBe(true);
    });

    it("should block files in secrets/ directory", () => {
      const result = scanner.scanPatch("", makeFile("secrets/api.txt", `key=123`));
      expect(result.blocked).toBe(true);
    });
  });

  describe("Allowed paths (whitelisted)", () => {
    it("should NOT scan .hades/secrets/ directory", () => {
      const result = scanner.scanPatch(
        "",
        makeFile(".hades/secrets/encrypted.bin", `AKIAIOSFODNN7EXAMPLE`),
      );
      expect(result.findings).toEqual([]);
      expect(result.blocked).toBe(false);
    });
  });

  describe("Redaction", () => {
    it("should redact matched snippets in findings", () => {
      const result = scanner.scanPatch(
        "",
        makeFile("config.ts", `const key = "AKIAIOSFODNN7EXAMPLE";`),
      );
      const finding = result.findings.find((f) => f.ruleName === "AWS Access Key ID");
      expect(finding?.matchedSnippet).not.toContain("IOSFODNN7EXAMPLE");
      expect(finding?.matchedSnippet).toContain("…");
    });
  });

  describe("Multiple files", () => {
    it("should scan all files in a patch", () => {
      const result = scanner.scanPatch("", [
        { path: "src/clean.ts", content: `export const x = 1;`, status: "added" },
        { path: "src/secret.ts", content: `const k = "AKIAIOSFODNN7EXAMPLE";`, status: "added" },
        { path: "src/also-clean.ts", content: `export const y = 2;`, status: "modified" },
      ]);
      expect(result.scannedFileCount).toBe(3);
      expect(result.findings.length).toBe(1);
      expect(result.blocked).toBe(true);
    });
  });
});
