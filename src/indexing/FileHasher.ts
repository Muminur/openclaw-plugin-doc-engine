import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileHashRecord, HashDiff } from "../types.js";

export function hashString(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  return hashString(content);
}

export function diffHashes(
  stored: Record<string, FileHashRecord>,
  current: Record<string, string>
): HashDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const key of Object.keys(current)) {
    if (!(key in stored)) {
      added.push(key);
    } else if (stored[key].hash !== current[key]) {
      changed.push(key);
    } else {
      unchanged.push(key);
    }
  }

  for (const key of Object.keys(stored)) {
    if (!(key in current)) {
      removed.push(key);
    }
  }

  return { added, changed, removed, unchanged };
}

export async function loadHashes(
  storagePath: string
): Promise<Record<string, FileHashRecord>> {
  try {
    const raw = await readFile(storagePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveHashes(
  storagePath: string,
  hashes: Record<string, FileHashRecord>
): Promise<void> {
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(storagePath, JSON.stringify(hashes), "utf-8");
}
