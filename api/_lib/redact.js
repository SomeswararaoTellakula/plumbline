// Privacy gateway: confidential terms and personal data are replaced with placeholders
// before any text is sent to the AI provider, and restored in the answer.

const PII = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/g, label: 'EMAIL' },
  { re: /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/g, label: 'PHONE' },
  { re: /\b[A-Za-z0-9._-]{2,}@(?:ok)?[a-z]{2,}\b/g, label: 'UPI_ID' },
];

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redact(text, confidentialTerms = []) {
  const map = [];
  let out = String(text);
  const sub = (re, label) => {
    out = out.replace(re, (m) => {
      const existing = map.find((x) => x.value === m);
      if (existing) return existing.token;
      const token = `[${label}_${map.length + 1}]`;
      map.push({ token, value: m });
      return token;
    });
  };
  for (const term of confidentialTerms) if (term && term.trim()) sub(new RegExp(escapeRegExp(term.trim()), 'gi'), 'CONFIDENTIAL');
  for (const p of PII) sub(p.re, p.label);
  return { text: out, map };
}

export function restore(value, map) {
  if (!map.length) return value;
  if (typeof value === 'string') return map.reduce((s, m) => s.split(m.token).join(m.value), value);
  if (Array.isArray(value)) return value.map((v) => restore(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v, map)]));
  return value;
}
