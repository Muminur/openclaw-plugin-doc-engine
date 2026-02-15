import type { EmbeddingProvider } from "../types.js";

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "have", "has",
  "had", "do", "does", "did", "will", "would", "could", "should", "may",
  "might", "can", "shall", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "into", "through", "during", "before", "after", "above",
  "below", "between", "but", "and", "or", "nor", "not", "no", "so", "if",
  "then", "than", "too", "very", "just", "about", "up", "out", "off", "over",
  "under", "each", "every", "all", "both", "few", "more", "most", "other",
  "some", "such", "only", "same", "that", "this", "these", "those", "it",
  "its", "he", "she", "they", "them", "their", "we", "our", "you", "your",
  "what", "which", "who", "whom", "when", "where", "how", "why",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

interface TfIdfEngine extends EmbeddingProvider {
  fit(documents: string[]): void;
  serialize(): object;
  deserialize(data: object): void;
}

interface SerializedState {
  vocabulary: string[];
  idf: Record<string, number>;
  docCount: number;
}

export function createTfIdfEngine(): TfIdfEngine {
  let vocabulary: string[] = [];
  let vocabIndex: Map<string, number> = new Map();
  let idf: Map<string, number> = new Map();
  let docCount = 0;

  function fit(documents: string[]): void {
    docCount = documents.length;
    const df = new Map<string, number>();
    const allTerms = new Set<string>();

    for (const doc of documents) {
      const tokens = tokenize(doc);
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        allTerms.add(token);
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }

    vocabulary = [...allTerms].sort();
    vocabIndex = new Map(vocabulary.map((term, i) => [term, i]));
    idf = new Map();
    for (const [term, freq] of df) {
      idf.set(term, Math.log(docCount / freq));
    }
  }

  function embed(text: string): number[] {
    const vec = new Array<number>(vocabulary.length).fill(0);
    const tokens = tokenize(text);
    if (tokens.length === 0) return vec;

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    for (const [term, count] of tf) {
      const idx = vocabIndex.get(term);
      if (idx !== undefined) {
        const termFreq = count / tokens.length;
        const termIdf = idf.get(term) ?? 0;
        vec[idx] = termFreq * termIdf;
      }
    }

    return vec;
  }

  function embedBatch(texts: string[]): number[][] {
    return texts.map(embed);
  }

  function serialize(): object {
    const idfObj: Record<string, number> = {};
    for (const [k, v] of idf) idfObj[k] = v;
    return { vocabulary, idf: idfObj, docCount } satisfies SerializedState;
  }

  function deserialize(data: object): void {
    const state = data as SerializedState;
    vocabulary = state.vocabulary;
    vocabIndex = new Map(vocabulary.map((term, i) => [term, i]));
    docCount = state.docCount;
    idf = new Map(Object.entries(state.idf));
  }

  return {
    fit,
    embed,
    embedBatch,
    serialize,
    deserialize,
    get dimensions() {
      return vocabulary.length;
    },
  };
}
