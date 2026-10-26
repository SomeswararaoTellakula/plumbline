// Text utilities shared by the browser and the serverless functions.
// Pure functions only: no DOM, no network.

export const STOPWORDS = new Set(
  'a an and are as at be been but by can do for from has have how i if in into is it its just more most my no not of on or our out over so than that the their them then there these they this to too up us was we what when which who will with you your yours via per all any every each'.split(' ')
);

/** Lowercase word tokens with light stemming. */
export function tokenize(text) {
  return (String(text).toLowerCase().match(/[a-z0-9₹%]+/g) || [])
    .filter((t) => !STOPWORDS.has(t))
    .map(stem);
}

export function stem(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  return word;
}

/** Split text into sentences, keeping character offsets. */
export function sentences(text) {
  const out = [];
  const src = String(text);
  // A boundary is ., ! or ? followed by whitespace or the end, or a line break.
  // "4.6", "nimbupay.example/security" and "Rs. 100" do not split.
  const boundary = /([.!?]+)(?=\s|$)|\n+/g;
  let last = 0;
  let m;
  const push = (s, e) => {
    const raw = src.slice(s, e);
    if (!raw.trim()) return;
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    out.push({ text: trimmed, start: s + lead, end: s + lead + trimmed.length });
  };
  while ((m = boundary.exec(src)) !== null) {
    const end = m.index + (m[1] ? m[1].length : 0);
    if (m[1] && /\b(?:rs|no|vs|mr|mrs|dr|approx|e\.g|i\.e)\.$/i.test(src.slice(Math.max(0, m.index - 6), end))) continue;
    push(last, end);
    last = m.index + m[0].length;
  }
  push(last, src.length);
  return out;
}

export function wordCount(text) {
  return (String(text).match(/[A-Za-z0-9₹'’-]+/g) || []).length;
}

export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch reading ease (higher is easier). */
export function fleschReadingEase(text) {
  const words = String(text).match(/[A-Za-z]+/g) || [];
  const sentenceCount = Math.max(1, sentences(text).length);
  if (!words.length) return 100;
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  return 206.835 - 1.015 * (words.length / sentenceCount) - 84.6 * (syl / words.length);
}

const MULTIPLIERS = {
  k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, crore: 1e7, crores: 1e7, cr: 1e7,
  million: 1e6, millions: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9,
};

const QUALIFIERS = [
  { re: /(more than|over|above|at least|upwards of|beyond)\s*$/i, kind: 'atLeast' },
  { re: /(up to|upto|as much as|maximum of|max)\s*$/i, kind: 'upTo' },
  { re: /(under|less than|below|within|in just|just)\s*$/i, kind: 'under' },
  { re: /(nearly|almost|around|about|approximately|approx\.?|roughly|~)\s*$/i, kind: 'approx' },
];

/**
 * Find quantities such as "5 million", "₹200", "2,50,000+", "4.6", "8", "45%".
 * Returns value (normalised), unitType and the qualifier that precedes it.
 */
export function parseQuantities(text) {
  const out = [];
  const re = /(₹|rs\.?\s?|inr\s?)?(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)(\s*(?:k|thousand|lakhs?|lac|crores?|cr|millions?|mn|m|billion|bn)(?![a-z]))?(\s*%)?(\+)?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].trim();
    let value = parseFloat(m[2].replace(/,/g, ''));
    if (Number.isNaN(value)) continue;
    const multWord = (m[3] || '').trim().toLowerCase();
    if (multWord) value *= MULTIPLIERS[multWord] || 1;
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24).toLowerCase();
    let unitType = 'count';
    if (m[1]) unitType = 'currency';
    else if (m[4]) unitType = 'percent';
    else if (/^\s*(seconds?|secs?|s\b|minutes?|mins?)/.test(after)) unitType = after.trim().startsWith('min') ? 'minutes' : 'seconds';
    else if (/^\s*(\/\s*5|out of 5|stars?|-star|star|rating|rated)/.test(after) || /(rated|rating of)\s*$/i.test(before)) unitType = 'rating';
    else if (/^\s*(x\b|times\b)/.test(after)) unitType = 'multiple';
    // Ignore list markers, years and times of day.
    if (unitType === 'count' && !multWord && !m[5] && value >= 1900 && value <= 2100 && !m[2].includes(',')) continue;
    if (/[:/]\s*$/.test(before) && unitType === 'count') continue;
    let qualifier = 'exact';
    if (m[5]) qualifier = 'atLeast';
    for (const q of QUALIFIERS) if (q.re.test(before)) { qualifier = q.kind; break; }
    out.push({ raw, value, unitType, qualifier, index: m.index, length: m[0].length, text: m[0] });
  }
  return out;
}

/** Display a normalised number the way Indian marketing copy usually does. */
export function formatQuantity(value, unitType) {
  const prefix = unitType === 'currency' ? '₹' : '';
  const suffix = unitType === 'percent' ? '%' : '';
  if (value >= 1e6 && unitType === 'count') return `${prefix}${trimNum(value / 1e6)} million${suffix}`;
  return `${prefix}${trimNum(value)}${suffix}`;
}

function trimNum(n) {
  return Number.isInteger(n) ? n.toLocaleString('en-IN') : String(Math.round(n * 100) / 100);
}

/** FNV-1a 32-bit hash, enough to detect content changes. */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Locate a quote in text, preferring the occurrence nearest a hint offset. */
export function locate(text, quote, hint = 0) {
  if (!quote) return null;
  const hits = [];
  let i = text.indexOf(quote);
  while (i !== -1) { hits.push(i); i = text.indexOf(quote, i + 1); }
  if (!hits.length) {
    const lower = text.toLowerCase();
    const q = quote.toLowerCase();
    let j = lower.indexOf(q);
    while (j !== -1) { hits.push(j); j = lower.indexOf(q, j + 1); }
  }
  if (!hits.length) return null;
  const best = hits.reduce((a, b) => (Math.abs(b - hint) < Math.abs(a - hint) ? b : a));
  return { start: best, end: best + quote.length };
}
