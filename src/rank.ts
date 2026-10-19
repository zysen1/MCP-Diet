// SPDX-License-Identifier: Apache-2.0

/**
 * Lexical ranker used by the scripted agent and by lazy search.
 * It is a fixture policy, not a model of an LLM.
 */
export const RANK = {
  id: 'scripted-lexical-v1',
  nameWeight: 2,
  k1: 1.2,
  b: 0.75,
} as const;

const STOP = new Set([
  'a', 'an', 'the', 'to', 'for', 'in', 'of', 'and', 'or', 'on', 'at', 'by',
  'with', 'from', 'is', 'it', 'this', 'that', 'be', 'as', 'into', 'about',
  'do', 'not', 'so', 'every', 'are', 'was', 'when', 'can', 'its', 'if',
]);

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP.has(token));
}

export interface RankDoc {
  name: string;
  text: string;
}

export interface Ranked extends RankDoc {
  score: number;
}

function unique(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

function bm25(query: string[], docs: string[][]): number[] {
  const n = docs.length;
  if (n === 0 || query.length === 0) return docs.map(() => 0);
  const df = new Map<string, number>();
  const lens = docs.map((doc) => doc.length);
  const avgdl = lens.reduce((sum, len) => sum + len, 0) / n;
  if (avgdl === 0) return docs.map(() => 0);
  for (const doc of docs) {
    for (const token of new Set(doc)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  return docs.map((doc, index) => {
    const tf = new Map<string, number>();
    for (const token of doc) tf.set(token, (tf.get(token) ?? 0) + 1);
    let score = 0;
    const len = lens[index] ?? 0;
    for (const term of query) {
      const freq = tf.get(term) ?? 0;
      if (freq === 0) continue;
      const docsWith = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - docsWith + 0.5) / (docsWith + 0.5));
      const denom = freq + RANK.k1 * (1 - RANK.b + RANK.b * (len / avgdl));
      score += idf * ((freq * (RANK.k1 + 1)) / denom);
    }
    return score;
  });
}

/** Higher score first. Ties break toward the shorter text, then the name. */
export function rankDocs(query: string, docs: RankDoc[]): Ranked[] {
  if (docs.length === 0) return [];
  const terms = unique(tokenize(query));
  const names = docs.map((doc) => tokenize(doc.name));
  const texts = docs.map((doc) => tokenize(doc.text));
  const nameScores = bm25(terms, names);
  const textScores = bm25(terms, texts);
  const ranked: Ranked[] = docs.map((doc, index) => ({
    name: doc.name,
    text: doc.text,
    score: (nameScores[index] ?? 0) * RANK.nameWeight + (textScores[index] ?? 0),
  }));
  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.text.length !== b.text.length) return a.text.length - b.text.length;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  return ranked;
}

export function roundScore(score: number): number {
  return Math.round(score * 1e6) / 1e6;
}
