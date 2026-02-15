import type { SearchResult } from "../types.js";

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export function resolveConflicts(results: SearchResult[]): SearchResult[] {
  if (results.length <= 1) return [...results];

  // Precompute word sets
  const wordSets = results.map((r) => wordSet(r.text));

  // Track which indices are kept (not deduplicated away)
  const removed = new Set<number>();

  for (let i = 0; i < results.length; i++) {
    if (removed.has(i)) continue;
    for (let j = i + 1; j < results.length; j++) {
      if (removed.has(j)) continue;
      const sim = jaccardSimilarity(wordSets[i], wordSets[j]);
      if (sim > 0.7) {
        // Keep the one with better (lower) priority; tiebreak on higher score
        const keepI =
          results[i].repoPriority < results[j].repoPriority ||
          (results[i].repoPriority === results[j].repoPriority &&
            results[i].score >= results[j].score);
        if (keepI) {
          removed.add(j);
        } else {
          removed.add(i);
          break; // i is removed, no need to check further
        }
      }
    }
  }

  const kept = results.filter((_, idx) => !removed.has(idx));

  // Sort by score DESC, then priority ASC
  kept.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.repoPriority - b.repoPriority;
  });

  return kept;
}
