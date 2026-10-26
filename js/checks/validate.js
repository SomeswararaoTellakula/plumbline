// The fix validator: a suggested rewrite may only use numbers that already appear in the
// original sentence or in the fact it cites, and may not add new superlatives or banned terms.
import { parseQuantities } from '../lib/text.js';
import { SUPERLATIVE_RE } from './claims.js';

function values(text) {
  return parseQuantities(text || '').map((q) => q.value);
}

export function validateFix({ replacement, original, sentence, fact, terms = [] }) {
  if (replacement == null) return { ok: false, reason: 'No rewrite was suggested.' };
  const allowed = new Set([...values(original), ...values(sentence), ...values(fact?.statement), ...(fact?.quantity ? [fact.quantity.value] : [])]);
  for (const v of values(replacement)) {
    const found = [...allowed].some((a) => Math.abs(a - v) <= Math.max(Math.abs(a) * 0.001, 1e-9));
    if (!found) return { ok: false, reason: `The rewrite introduced a number (${v.toLocaleString('en-IN')}) that is not in the original text or the cited fact.` };
  }
  const sup = (s) => new Set((String(s).match(SUPERLATIVE_RE) || []).map((w) => w.toLowerCase()));
  const before = sup(`${original} ${sentence}`);
  for (const w of sup(replacement)) {
    if (!before.has(w) && !(fact && fact.statement.toLowerCase().includes(w))) return { ok: false, reason: `The rewrite added a new ranking claim ("${w}").` };
  }
  const lower = String(replacement).toLowerCase();
  for (const t of terms) {
    if ((t.kind === 'banned' || t.kind === 'competitor') && lower.includes(t.term.toLowerCase()) && !String(original).toLowerCase().includes(t.term.toLowerCase())) {
      return { ok: false, reason: `The rewrite introduced a banned term ("${t.term}").` };
    }
  }
  if (String(replacement).length > Math.max(400, String(original).length * 3)) return { ok: false, reason: 'The rewrite is much longer than the original, so it may change the meaning.' };
  return { ok: true, reason: '' };
}
