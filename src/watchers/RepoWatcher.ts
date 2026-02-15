import { watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { RepoConfig } from "../types.js";

export interface RepoWatcher {
  start(): void;
  stop(): void;
}

function resolvePath(p: string): string {
  if (p.startsWith("~")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function createRepoWatcher(config: {
  repos: RepoConfig[];
  debounceMs: number;
  onFileChange: (repo: string, file: string) => Promise<void>;
}): RepoWatcher {
  const watchers: FSWatcher[] = [];
  const pending = new Map<string, NodeJS.Timeout>();

  function start(): void {
    for (const repo of config.repos) {
      const dir = resolvePath(repo.path);
      if (!existsSync(dir)) {
        continue;
      }

      try {
        const w = watch(dir, { recursive: true }, (_event, filename) => {
          if (!filename || !filename.endsWith(".md")) return;

          const key = `${repo.name}:${filename}`;
          const existing = pending.get(key);
          if (existing) clearTimeout(existing);

          pending.set(
            key,
            setTimeout(() => {
              pending.delete(key);
              config.onFileChange(repo.name, filename).catch(() => {});
            }, config.debounceMs)
          );
        });
        watchers.push(w);
      } catch {
        // skip directories that can't be watched
      }
    }
  }

  function stop(): void {
    for (const w of watchers) {
      w.close();
    }
    watchers.length = 0;
    for (const timeout of pending.values()) {
      clearTimeout(timeout);
    }
    pending.clear();
  }

  return { start, stop };
}
