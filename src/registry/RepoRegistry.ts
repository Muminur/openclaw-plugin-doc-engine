import type { RepoConfig } from "../types.js";
import { readdir, access } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { constants } from "node:fs";

export interface RepoRegistry {
  scan(): Promise<Map<string, string[]>>;
  getRepo(name: string): RepoConfig | undefined;
  resolveGlob(repo: RepoConfig): Promise<string[]>;
  allRepos(): RepoConfig[];
}

function resolvePath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  if (p === "~") {
    return homedir();
  }
  return p;
}

/**
 * Simple glob matcher supporting:
 * - `** /*.md`  → all .md files recursively
 * - `** /SKILL.md` → only files named SKILL.md recursively
 * - `*.md` → .md files in root only
 */
function matchesGlob(
  relativePath: string,
  pattern: string,
): boolean {
  // **/*.ext — recursive, match extension
  if (pattern.startsWith("**/")) {
    const rest = pattern.slice(3); // e.g. "*.md" or "SKILL.md"
    const fileName = basename(relativePath);

    if (rest.startsWith("*")) {
      // **/*.md — match by extension
      const ext = rest.slice(1); // ".md"
      return fileName.endsWith(ext);
    }
    // **/SKILL.md — match exact filename
    return fileName === rest;
  }

  // *.ext — root level only, no path separators
  if (pattern.startsWith("*") && !pattern.includes("/")) {
    const ext = pattern.slice(1); // ".md"
    // Must be root-level: no directory separators in relativePath
    return !relativePath.includes("/") && relativePath.endsWith(ext);
  }

  // Exact match fallback
  return relativePath === pattern;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      // entry.parentPath is available in Node 20+, fallback to entry.path
      const parent = entry.parentPath ?? (entry as any).path ?? dir;
      files.push(join(parent, entry.name));
    }
  }
  return files;
}

export function createRepoRegistry(configs: RepoConfig[]): RepoRegistry {
  const configMap = new Map<string, RepoConfig>();
  for (const c of configs) {
    configMap.set(c.name, c);
  }

  async function resolveGlob(repo: RepoConfig): Promise<string[]> {
    const resolvedPath = resolvePath(repo.path);
    const pattern = repo.glob ?? "**/*.md";

    try {
      await access(resolvedPath, constants.R_OK);
    } catch {
      console.warn(`RepoRegistry: directory not found: ${resolvedPath}`);
      return [];
    }

    const allFiles = await listFilesRecursive(resolvedPath);
    return allFiles.filter((f) => {
      const relative = f.slice(resolvedPath.length + 1); // strip base + separator
      return matchesGlob(relative, pattern);
    });
  }

  return {
    async scan(): Promise<Map<string, string[]>> {
      const result = new Map<string, string[]>();
      for (const config of configs) {
        const files = await resolveGlob(config);
        result.set(config.name, files);
      }
      return result;
    },

    getRepo(name: string): RepoConfig | undefined {
      return configMap.get(name);
    },

    resolveGlob,

    allRepos(): RepoConfig[] {
      return [...configs].sort((a, b) => a.priority - b.priority);
    },
  };
}
