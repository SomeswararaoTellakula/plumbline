// Claim detection and grounding against the fact ledger.
// The comparator is deterministic: a model never decides alone whether a number is right.
import { sentences, parseQuantities, formatQuantity, tokenize } from '../lib/text.js';
import { retrieveFacts } from '../lib/retrieval.js';

export const SUPERLATIVE_RE = /\b(?:india['’]s\s+)?(?:fastest|best|cheapest|largest|biggest|safest|most\s+(?:trusted|secure|popular|loved|reliable)|no\.?\s?1|number\s+one|#1|leading|unbeatable|first-ever|world-class)\b/gi;

export function isExpired(fact, today) {
  return Boolean(fact && fact.expires && fact.expires < today);
}

const UNIT_ALIASES = { minutes: 'seconds' };

function comparable(claimQ, factQ) {
  if (!factQ) return null;
  let value = claimQ.value;
  let unit = claimQ.unitType;
  if (unit === 'minutes') { value *= 60; unit = UNIT_ALIASES.minutes; }
  if (unit !== factQ.unitType) return null;
  return value;
}

/** Is the claimed quantity true given the approved fact? */
export function compareQuantity(claimQ, factQ) {
  const v = comparable(claimQ, factQ);
  if (v === null) return null;
  const f = factQ.value;
  const close = (tol) => Math.abs(v - f) <= Math.max(Math.abs(f) * tol, 1e-9);
  switch (claimQ.qualifier) {
    case 'atLeast': return v <= f * 1.001;          // "over 4 million" is true if the fact is 4.2 million
    case 'upTo': return v <= f * 1.001;             // "up to ₹200" overstates a ₹100 maximum
    case 'under': return v >= f * 0.999;            // "under 5 seconds" is true if the fact is 2 seconds
    case 'approx': return close(0.1);
    default:
      if (factQ.qualifier === 'upTo') return v <= f * 1.001;
      if (factQ.qualifier === 'atLeast') return v <= f * 1.001 && v >= f * 0.9;
      return close(0.03);
  }
}

const STOP_FOLLOW = new Set('and or but so to on in for with from at of the a an across by is are was this that your our its their as than when where while'.split(' '));

/** Up to `max` following words, stopping at conjunctions and prepositions. */
export function followingWords(text, from, limit, max = 2) {
  const re = /^\s+([A-Za-z][A-Za-z'’-]*)/;
  let pos = from;
  for (let i = 0; i < max; i++) {
    const m = text.slice(pos, limit).match(re);
    if (!m || STOP_FOLLOW.has(m[1].toLowerCase())) break;
    pos += m[0].length;
  }
  return pos;
}

/** Short phrase around a quantity: qualifier + number + up to two following words. */
function phraseAround(text, sentence, q) {
  const start = q.index;
  let end = followingWords(text, q.index + q.length, sentence.end);
  let qStart = start;
  const before = text.slice(sentence.start, start);
  const qual = before.match(/(more than|over|above|at least|up to|upto|under|less than|nearly|almost|around|about|just)\s*$/i);
  if (qual) qStart = start - qual[0].length;
  return { start: qStart, end, text: text.slice(qStart, end) };
}

function windowAround(text, sentence, index, length) {
  const s = Math.max(sentence.start, index - 45);
  const e = Math.min(sentence.end, index + length + 45);
  return text.slice(s, e);
}

/** Find claims a rule can see: numbers with a unit or a metric, and rankings/superlatives. */
export function detectClaims(text) {
  const claims = [];
  for (const s of sentences(text)) {
    for (const q of parseQuantities(s.text)) {
      const absIndex = s.start + q.index;
      const absQ = { ...q, index: absIndex };
      const phrase = phraseAround(text, s, absQ);
      claims.push({ kind: 'numeric', quantity: absQ, quote: phrase.text, start: phrase.start, end: phrase.end, sentence: s.text, context: windowAround(text, s, absIndex, q.length) });
    }
    SUPERLATIVE_RE.lastIndex = 0;
    let m;
    while ((m = SUPERLATIVE_RE.exec(s.text)) !== null) {
      if (/cheapest/i.test(m[0])) continue; // handled as a banned term
      const start = s.start + m.index;
      const end = followingWords(text, start + m[0].length, s.end);
      claims.push({ kind: 'ranking', word: m[0], quote: text.slice(start, end), start, end, sentence: s.text, context: s.text });
    }
  }
  return claims;
}

/**
 * Ground one claim. Returns { verdict, fact, candidates, decidedBy, reason, fix }.
 * verdict: supported | contradicted | outdated | unsupported
 */
export function groundClaim(claim, facts, today) {
  const usable = facts.filter((f) => !f.confidential);
  const candidates = retrieveFacts(claim.context, usable, 4);
  if (claim.kind === 'numeric') {
    const q = claim.quantity;
    const match = candidates.find((c) => c.fact.quantity && c.keywordHits > 0 && comparable(q, c.fact.quantity) !== null);
    if (!match) {
      return { verdict: 'unsupported', fact: null, candidates, decidedBy: 'retrieval', reason: `No approved fact in the ledger covers "${claim.quote.trim()}".`, fix: null };
    }
    const fact = match.fact;
    const ok = compareQuantity(q, fact.quantity);
    const expired = isExpired(fact, today);
    if (ok && !expired) return { verdict: 'supported', fact, candidates, decidedBy: 'comparator', reason: `Matches ${fact.id}: ${fact.statement}`, fix: null };
    if (ok && expired) return { verdict: 'outdated', fact, candidates, decidedBy: 'comparator', reason: `Matches ${fact.id}, but that fact expired on ${fact.expires}. The ${fact.owner} must confirm a current figure before this is published.`, fix: null };
    const fixed = rewriteQuantity(claim, fact);
    return { verdict: 'contradicted', fact, candidates, decidedBy: 'comparator', reason: `Says ${q.raw}${qualifierWord(q.qualifier)}, but ${fact.id} says ${fact.display} (${fact.statement})${expired ? ` That fact has also expired (${fact.expires}).` : ''}`, fix: fixed ? { replacement: fixed, note: `Uses the approved figure from ${fact.id}.` } : null };
  }
  // Rankings need a fact that literally supports the ranking word.
  const word = claim.word.toLowerCase().replace(/^india['’]s\s+/, '');
  const proving = usable.find((f) => f.statement.toLowerCase().includes(word));
  if (proving) return { verdict: 'supported', fact: proving, candidates, decidedBy: 'retrieval', reason: `Supported by ${proving.id}.`, fix: null };
  const closest = candidates[0]?.fact || null;
  return { verdict: 'unsupported', fact: closest, candidates, decidedBy: 'retrieval', reason: `"${claim.quote.trim()}" is a ranking claim and no approved fact proves it.${closest ? ` The closest approved fact is ${closest.id}: ${closest.statement}` : ''}`, fix: null };
}

function qualifierWord(q) {
  return { atLeast: ' (as a minimum)', upTo: ' (as a maximum)', under: ' (as an upper limit)', approx: ' (approximately)' }[q] || '';
}

/** Replace the number in the claim phrase with the approved figure. */
export function rewriteQuantity(claim, fact) {
  const q = claim.quantity;
  const fq = fact.quantity;
  const phrase = claim.quote;
  const rel = q.index - claim.start;
  if (rel < 0 || rel > phrase.length) return null;
  let numberText = formatQuantity(fq.value, fq.unitType);
  let before = phrase.slice(0, rel);
  const after = phrase.slice(rel + q.length);
  if (fq.qualifier === 'upTo' && !/up\s?to\s*$/i.test(before)) numberText = 'up to ' + numberText;
  if (fq.qualifier === 'approx' && !/(about|around|nearly)\s*$/i.test(before)) numberText = 'about ' + numberText;
  if (fq.qualifier === 'atLeast' && !/(over|more than|at least)\s*$/i.test(before)) numberText = 'over ' + numberText;
  const spacer = after && !/^\s/.test(after) && /^[A-Za-z]/.test(after) ? ' ' : '';
  return (before + numberText + spacer + after).replace(/\s{2,}/g, ' ');
}

/** Words that appear in the ledger, used to judge whether a rewrite added new claims. */
export function ledgerVocabulary(facts) {
  return new Set(facts.flatMap((f) => tokenize(f.statement)));
}
