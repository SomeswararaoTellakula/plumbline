// BM25 retrieval over the fact ledger. Used in the browser (deterministic checks)
// and in the serverless function (to give the AI only the closest approved facts).
import { tokenize } from './text.js';

function factDocument(fact) {
  return [fact.statement, fact.metric || '', (fact.keywords || []).join(' ')].join(' ');
}

/**
 * Rank facts against a claim. Returns [{ fact, score, overlap }] best first.
 * `overlap` is the share of the fact's keywords that appear in the claim.
 */
export function retrieveFacts(claimText, facts, k = 4) {
  const docs = facts.map((f) => tokenize(factDocument(f)));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const q = [...new Set(tokenize(claimText))];
  const N = docs.length, k1 = 1.4, b = 0.75;
  const claimLower = String(claimText).toLowerCase();
  const scored = facts.map((fact, i) => {
    const d = docs[i];
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen)));
    }
    const kws = fact.keywords || [];
    const hits = kws.filter((kw) => claimLower.includes(kw.toLowerCase())).length;
    const overlap = kws.length ? hits / kws.length : 0;
    score += hits * 0.8;
    return { fact, score, overlap, keywordHits: hits };
  });
  return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
}
