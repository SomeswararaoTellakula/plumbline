// Answers Gemini gave earlier for the unchanged demo drafts and bundled demo images.
// They are used only when a live AI call fails (for example when the free-tier quota is used up),
// only for an exact match of the draft text and Brand Kit, and the page labels them as recorded.
// Regenerate with: node scripts/build-recorded.mjs
import { createHash } from 'node:crypto';
import { REVIEWS, IMAGES } from './recorded-data.js';

/** A fingerprint of everything the AI review depends on, except today's date. */
export function reviewKey({ text, brand, facts, rules, tone, confidentialTerms }) {
  const shape = {
    text,
    brand,
    rules: (rules || []).map((r) => [r.id, r.title, r.description]),
    facts: (facts || []).map((f) => [f.id, f.statement, f.expires || '']),
    tone: [tone?.voice || '', tone?.do || [], tone?.dont || [], tone?.keyMessages || []],
    confidentialTerms: confidentialTerms || [],
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 32);
}

export function recordedReview(key) { return REVIEWS[key] || null; }
export function recordedImage(asset) { return /^assets\/[\w.-]+$/.test(asset) ? IMAGES[asset] || null : null; }
