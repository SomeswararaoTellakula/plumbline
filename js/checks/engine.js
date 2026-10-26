// Review engine: deterministic checks first, then merging of AI-assisted results.
// Every finding names the rule (and fact, where relevant) behind it.
import { sentences, wordCount, escapeRegExp, locate } from '../lib/text.js';
import { detectClaims, groundClaim, isExpired } from './claims.js';
import { validateFix } from './validate.js';
import { contrastRatio, nearestPaletteColour, hexToRgb } from '../lib/color.js';

export const SEVERITY_ORDER = { blocker: 0, high: 1, medium: 2, low: 3 };
const ACRONYMS = new Set(['UPI', 'RBI', 'DTH', 'PIN', 'QR', 'ID', 'EMI', 'KYC', 'NPCI', 'SMS', 'OTP', 'T&C', 'FAQ', 'ATM', 'GST', 'PAN', 'INR', 'DIWALI']);

function ruleOf(ws, id) {
  return ws.rules.find((r) => r.id === id);
}

function active(ws, id) {
  const r = ruleOf(ws, id);
  return !r || r.active !== false;
}

function finding(ws, base) {
  const rule = ruleOf(ws, base.ruleId);
  return {
    id: '',
    source: 'rule',
    category: rule?.category || 'Other',
    severity: base.severity || rule?.severity || 'medium',
    factId: null,
    fix: null,
    confidence: 1,
    status: 'open',
    resolution: null,
    target: 'text',
    aiAssisted: false,
    ...base,
  };
}

function sentenceAt(text, index) {
  return sentences(text).find((s) => index >= s.start && index <= s.end) || { text, start: 0, end: text.length };
}

/** Rules that need no model: terminology, competitors, offers, confidentiality, tone mechanics. */
export function runTextChecks(ws, text) {
  const out = [];
  // TRM-01 brand name casing
  if (active(ws, 'TRM-01')) {
    const re = /\bnimbu[\s-]?pay\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === ws.brand.name) continue;
      const prev = text[m.index - 1] || '';
      const next2 = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (/[/.@]/.test(prev) || /^\.[a-z]/i.test(next2)) continue; // part of a URL, domain or email
      out.push(finding(ws, { ruleId: 'TRM-01', title: 'Brand name written incorrectly', quote: m[0], start: m.index, end: m.index + m[0].length, reason: `"${m[0]}" should be written "${ws.brand.name}".`, fix: { replacement: ws.brand.name, note: 'Exact brand spelling.' } }));
    }
  }
  // Terminology list: banned words, preferred terms, competitors
  for (const t of ws.terms) {
    if (!active(ws, t.ruleId)) continue;
    const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(t.term)}(?![A-Za-z])`, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (t.kind === 'competitor') {
        const s = sentenceAt(text, m.index);
        const local = text.slice(s.start, s.end);
        const rel = m.index - s.start;
        const clauseStart = Math.max(local.lastIndexOf(',', rel), local.lastIndexOf(';', rel), local.lastIndexOf('—', rel));
        let qs = s.start + (clauseStart >= 0 ? clauseStart : 0);
        let qe = m.index + m[0].length;
        const afterTerm = text.slice(qe, s.end).match(/^[^,.;!?]*/);
        if (afterTerm) qe += afterTerm[0].length;
        const quote = text.slice(qs, qe);
        const whole = clauseStart < 0;
        out.push(finding(ws, { ruleId: t.ruleId, title: 'Names a competitor', quote, start: qs, end: qe, reason: `Mentions "${m[0]}". Brand guidelines say to talk about what ${ws.brand.name} does well, not about other apps.`, fix: whole ? null : { replacement: '', note: 'Removes the comparison and keeps the rest of the sentence.' } }));
      } else if (t.kind === 'banned') {
        let bs = m.index;
        const art = text.slice(Math.max(0, m.index - 4), m.index).match(/\b(a|an|the)\s+$/i);
        if (art && /^(a|an|the)\s/i.test(t.replacement || '')) bs = m.index - art[0].length;
        out.push(finding(ws, { ruleId: t.ruleId, title: `Banned phrase: "${t.term}"`, quote: text.slice(bs, m.index + m[0].length), start: bs, end: m.index + m[0].length, reason: `"${m[0]}" is on the banned list (${t.id}).`, fix: t.replacement ? { replacement: t.replacement, note: 'Approved alternative from the terminology list.' } : null }));
      } else {
        out.push(finding(ws, { ruleId: t.ruleId, title: `Use "${t.replacement}"`, quote: m[0], start: m.index, end: m.index + m[0].length, reason: `The approved term is "${t.replacement}" (${t.id}).`, fix: { replacement: t.replacement, note: 'Preferred product term.' } }));
      }
    }
  }
  // CLM-03 guaranteed outcomes
  if (active(ws, 'CLM-03')) {
    const re = /\b(guaranteed|guarantees?|never fails?|zero (?:risk|failures?)|100% (?:secure|safe|guaranteed))\b\s?/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const word = m[0].trim();
      const adjective = /^guaranteed$/i.test(word);
      out.push(finding(ws, { ruleId: 'CLM-03', title: 'Promises a guaranteed outcome', quote: adjective ? m[0] : word, start: m.index, end: m.index + (adjective ? m[0].length : word.length), reason: `"${word}" promises an outcome the brand cannot guarantee. Offers and protection depend on terms.`, fix: adjective ? { replacement: '', note: 'Removes the guarantee and keeps the offer.' } : null }));
    }
  }
  // CNF-01 confidential project names
  if (active(ws, 'CNF-01')) {
    for (const term of ws.tone.confidentialTerms || []) {
      const re = new RegExp(escapeRegExp(term), 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        const s = sentenceAt(text, m.index);
        out.push(finding(ws, { ruleId: 'CNF-01', title: 'Mentions a confidential project', quote: s.text, start: s.start, end: s.end, reason: `"${m[0]}" is on the confidential list. It must not appear in external content, and it is never sent to the AI.`, fix: { replacement: '', note: 'Removes the sentence.' } }));
      }
    }
  }
  // LEG-01 offers need T&C
  if (active(ws, 'LEG-01') && /\b(cashback|discount|offer|coupon|% off)\b/i.test(text) && !/T&Cs?|terms (and|&) conditions/i.test(text)) {
    const s = sentences(text).find((x) => /\b(cashback|discount|offer|coupon|% off)\b/i.test(x.text));
    // Content-level finding: the fix appends the disclaimer, so later edits cannot strand it.
    if (s) out.push(finding(ws, { ruleId: 'LEG-01', title: 'Offer without "T&C apply"', quote: null, start: null, end: null, reason: `"${s.text.length > 80 ? s.text.slice(0, 77) + '…' : s.text}" describes an offer, but the content never says "T&C apply".`, fix: { replacement: 'T&C apply.', note: 'Adds the required disclaimer at the end of the content.', kind: 'append' } }));
  }
  // TON-01 hype mechanics
  if (active(ws, 'TON-01')) {
    const re = /!{2,}/g;
    let m;
    while ((m = re.exec(text)) !== null) out.push(finding(ws, { ruleId: 'TON-01', title: 'Several exclamation marks', quote: m[0], start: m.index, end: m.index + m[0].length, reason: 'The voice guide allows at most one exclamation mark at a time; several read as hype.', fix: { replacement: '!', note: 'One exclamation mark.' } }));
    const caps = /\b([A-Z]{3,}(?:\s+[A-Z]{3,})+)\b/g;
    while ((m = caps.exec(text)) !== null) {
      if (m[1].split(/\s+/).every((w) => ACRONYMS.has(w))) continue;
      out.push(finding(ws, { ruleId: 'TON-01', title: 'ALL CAPS shouting', quote: m[1], start: m.index, end: m.index + m[1].length, reason: 'Words in capitals read as shouting.', fix: { replacement: m[1].charAt(0) + m[1].slice(1).toLowerCase(), note: 'Sentence case.' } }));
    }
  }
  // TON-04 long sentences
  if (active(ws, 'TON-04')) {
    for (const s of sentences(text)) {
      const n = wordCount(s.text);
      if (n > 30) out.push(finding(ws, { ruleId: 'TON-04', title: `Long sentence (${n} words)`, quote: s.text, start: s.start, end: s.end, reason: `Sentences should stay under 30 words; this one has ${n}.` }));
    }
  }
  return out;
}

/** Ground every claim a rule can see against the fact ledger. */
export function runClaimChecks(ws, text, today) {
  const findings = [];
  const supported = [];
  for (const claim of detectClaims(text)) {
    const g = groundClaim(claim, ws.facts, today);
    const factId = g.fact?.id || null;
    if (g.verdict === 'supported') { supported.push({ quote: claim.quote, factId }); continue; }
    if (claim.kind === 'numeric' && g.verdict === 'unsupported') {
      // Plain counts with no metric words (e.g. "in 2 steps") are not claims worth blocking on.
      if (claim.quantity.unitType === 'count' && !g.candidates.length) continue;
    }
    const ruleId = g.verdict === 'outdated' ? 'CLM-04' : claim.kind === 'ranking' ? 'CLM-02' : 'CLM-01';
    if (!active(ws, ruleId)) continue;
    const severity = g.verdict === 'contradicted' ? 'blocker' : g.verdict === 'outdated' ? 'high' : 'high';
    const title = { contradicted: 'Contradicts the fact ledger', outdated: 'Relies on an expired fact', unsupported: claim.kind === 'ranking' ? 'Ranking claim without a source' : 'Figure without an approved source' }[g.verdict];
    let fix = g.fix;
    if (fix) {
      const v = validateFix({ replacement: fix.replacement, original: claim.quote, sentence: claim.sentence, fact: g.fact, terms: ws.terms });
      if (!v.ok) fix = null;
    }
    findings.push(finding(ws, { ruleId, severity, title, quote: claim.quote, start: claim.start, end: claim.end, factId, reason: g.reason, fix, verdict: g.verdict, decidedBy: g.decidedBy, claimKind: claim.kind, candidates: g.candidates.map((c) => c.fact.id) }));
  }
  return { findings, supported };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

/** Remove duplicate findings on the same span, keeping the most severe. */
export function dedupe(findings) {
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const kept = [];
  for (const f of sorted) {
    const dup = kept.find((k) => k.target === f.target && k.start != null && f.start != null && overlaps(k, f) && (k.ruleId === f.ruleId || (k.ruleId.startsWith('CLM') && f.ruleId.startsWith('CLM')) || (k.ruleId === 'TRM-02' && f.ruleId === 'CLM-03') || (k.ruleId === 'CLM-03' && f.ruleId === 'TRM-02')));
    if (!dup) kept.push(f);
  }
  return kept.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.start ?? 1e9) - (b.start ?? 1e9));
}

export function runDeterministic(ws, text, today) {
  const textFindings = runTextChecks(ws, text);
  const claims = runClaimChecks(ws, text, today);
  return { findings: dedupe([...textFindings, ...claims.findings]), supported: claims.supported };
}

const VERDICT_RULE = { contradicted: 'CLM-01', outdated: 'CLM-04' };

/**
 * Merge the AI response into the deterministic findings.
 * - Numbers already decided by the comparator keep the comparator's verdict.
 * - AI rewrites must pass the validator; rejected rewrites are reported, not shown as fixes.
 */
export function mergeAI(ws, text, det, ai, today) {
  const findings = det.findings.map((f) => ({ ...f }));
  const supported = [...det.supported];
  const model = ai?.model || 'AI';
  const factById = (id) => ws.facts.find((f) => f.id === id) || null;

  for (const c of ai?.claims || []) {
    const loc = locate(text, c.quote);
    if (!loc) continue;
    const span = { start: loc.start, end: loc.end };
    const sentence = sentenceAt(text, loc.start).text;
    const fact = factById(c.factId);
    const existing = findings.find((f) => f.target === 'text' && f.ruleId?.startsWith('CLM') && overlaps(f, span));
    const lowConfidence = (c.confidence ?? 0) < 0.6;
    if (existing) {
      existing.aiAssisted = true;
      existing.source = existing.decidedBy === 'comparator' ? 'hybrid' : 'hybrid';
      existing.model = model;
      if (existing.decidedBy !== 'comparator' && c.verdict === 'supported' && !lowConfidence && fact) {
        // Rule and AI disagree: neither decides alone, a person does.
        existing.verdict = 'needs-check';
        existing.severity = 'medium';
        existing.title = 'Needs human check';
        existing.factId = fact.id;
        existing.reason += ` The AI read it as supported by ${fact.id}, so the rule and the AI disagree. Check the cited fact before deciding.`;
      }
      if (c.explanation && existing.decidedBy !== 'comparator') existing.aiNote = c.explanation;
      if (c.suggestedRewrite && c.suggestedRewrite !== c.quote) {
        const target = text.slice(existing.start, existing.end);
        const rewriteSpanMatches = locate(target, c.quote) || c.quote.includes(target);
        const v = validateFix({ replacement: c.suggestedRewrite, original: c.quote, sentence, fact: fact || factById(existing.factId), terms: ws.terms });
        if (v.ok && rewriteSpanMatches) {
          existing.quote = c.quote; existing.start = loc.start; existing.end = loc.end;
          existing.fix = { replacement: c.suggestedRewrite, note: `AI-suggested rewrite, checked by the validator${fact ? ` against ${fact.id}` : ''}.`, ai: true };
        } else if (!v.ok) existing.rejectedFix = { replacement: c.suggestedRewrite, reason: v.reason };
      }
      continue;
    }
    if (c.verdict === 'supported' && !lowConfidence) { supported.push({ quote: c.quote, factId: fact?.id || null }); continue; }
    let verdict = c.verdict;
    if (verdict === 'supported' && lowConfidence) verdict = 'needs-check';
    if (fact && isExpired(fact, today) && verdict === 'supported') verdict = 'outdated';
    const ruleId = VERDICT_RULE[verdict] || (c.claimType === 'ranking' ? 'CLM-02' : 'CLM-01');
    if (!active(ws, ruleId)) continue;
    const severity = verdict === 'contradicted' ? 'blocker' : verdict === 'needs-check' ? 'medium' : 'high';
    const titles = { contradicted: 'Contradicts the fact ledger', outdated: 'Relies on an expired fact', unsupported: 'Claim without an approved source', 'needs-check': 'Needs human check' };
    let fix = null, rejectedFix = null;
    if (c.suggestedRewrite && c.suggestedRewrite !== c.quote) {
      const v = validateFix({ replacement: c.suggestedRewrite, original: c.quote, sentence, fact, terms: ws.terms });
      if (v.ok) fix = { replacement: c.suggestedRewrite, note: `AI-suggested rewrite, checked by the validator${fact ? ` against ${fact.id}` : ''}.`, ai: true };
      else rejectedFix = { replacement: c.suggestedRewrite, reason: v.reason };
    }
    findings.push(finding(ws, {
      ruleId, severity, title: titles[verdict] || 'Claim to check', quote: c.quote, start: loc.start, end: loc.end,
      factId: fact?.id || null, reason: c.explanation || 'The AI flagged this as a claim that the fact ledger does not support.',
      fix, rejectedFix, verdict, source: 'ai', aiAssisted: true, model, confidence: c.confidence ?? 0.5, claimKind: c.claimType,
    }));
  }

  for (const issue of ai?.issues || []) {
    const loc = locate(text, issue.quote);
    if (!loc) continue;
    const rule = ruleOf(ws, issue.ruleId);
    if (!rule || rule.active === false) continue;
    const span = { start: loc.start, end: loc.end };
    if (findings.some((f) => f.target === 'text' && f.ruleId === rule.id && overlaps(f, span))) continue;
    const sentence = sentenceAt(text, loc.start).text;
    let fix = null, rejectedFix = null;
    if (issue.suggestedRewrite && issue.suggestedRewrite !== issue.quote) {
      const v = validateFix({ replacement: issue.suggestedRewrite, original: issue.quote, sentence, fact: null, terms: ws.terms });
      if (v.ok) fix = { replacement: issue.suggestedRewrite, note: 'AI-suggested rewrite that keeps your message.', ai: true };
      else rejectedFix = { replacement: issue.suggestedRewrite, reason: v.reason };
    }
    const confidence = issue.confidence ?? 0.6;
    findings.push(finding(ws, {
      ruleId: rule.id, severity: confidence < 0.5 ? 'low' : rule.severity === 'blocker' ? 'high' : rule.severity, title: issue.title || rule.title, quote: issue.quote, start: loc.start, end: loc.end,
      reason: issue.explanation, fix, rejectedFix, source: 'ai', aiAssisted: true, model, confidence,
    }));
  }

  if (ai && Array.isArray(ai.keyMessagesCovered) && ai.keyMessagesCovered.length === 0 && active(ws, 'MSG-01') && wordCount(text) > 25) {
    findings.push(finding(ws, { ruleId: 'MSG-01', title: 'No key message', quote: null, start: null, end: null, reason: `None of the key messages (${ws.tone.keyMessages.map((k) => k.split(':')[0]).join(', ')}) comes through.`, source: 'ai', aiAssisted: true, model, confidence: 0.6 }));
  }

  return { findings: dedupe(findings), supported };
}

/** Claims and banned wording inside an image, from the text the AI read in it. */
export function imageTextFindings(ws, visibleText, today, bodyText = '') {
  if (!visibleText || !visibleText.trim()) return [];
  const det = runDeterministic(ws, visibleText, today);
  // "T&C apply" is content-level: the post text either already has it or is already flagged.
  const offerInBody = /\b(cashback|discount|offer|coupon|% off)\b/i.test(bodyText);
  const tcInBody = /T&Cs?|terms (and|&) conditions/i.test(bodyText);
  return det.findings
    .filter((f) => !['TON-04', 'TRM-01', 'TON-01'].includes(f.ruleId))
    .filter((f) => f.ruleId !== 'LEG-01' || (!offerInBody && !tcInBody))
    .map((f) => ({
      ...f, target: 'image', start: null, end: null, aiAssisted: true,
      title: `In the image: ${f.title.charAt(0).toLowerCase()}${f.title.slice(1)}`,
      quote: f.quote,
      reason: `${f.reason} (Read from the image by the AI${f.quote ? `: "${f.quote}"` : ''}.)`,
      fix: f.fix ? { replacement: f.fix.replacement, note: 'Suggested wording for the artwork. Update the image file; this cannot be applied automatically.', kind: 'artwork' } : null,
    }));
}

/**
 * Image findings from the browser's colour analysis and (optionally) the AI's reading of the image.
 * analysis = { clusters: [{hex, share}], estimatedContrast, textColour, bgColour }
 */
export function imageFindings(ws, image, analysis, aiImage) {
  const out = [];
  if (!image) return out;
  if (active(ws, 'ACC-01') && !String(image.alt || '').trim()) {
    out.push(finding(ws, { ruleId: 'ACC-01', target: 'image', title: 'Image has no alt text', quote: null, start: null, end: null, reason: 'Screen-reader users get no description of this image.', fix: aiImage?.altText ? { replacement: aiImage.altText, note: 'AI-drafted description of the image. Edit before accepting if needed.', ai: true, kind: 'alt' } : null, aiAssisted: Boolean(aiImage?.altText), model: aiImage?.model }));
  }
  if (analysis && active(ws, 'VIS-01')) {
    const off = analysis.clusters.filter((c) => c.share >= 0.08).map((c) => ({ ...c, nearest: nearestPaletteColour(hexToRgb(c.hex), ws.palette) })).filter((c) => c.nearest.distance > 12);
    if (off.length) {
      const share = Math.round(off.reduce((s, c) => s + c.share, 0) * 100);
      out.push(finding(ws, { ruleId: 'VIS-01', target: 'image', title: 'Colours outside the brand palette', quote: null, start: null, end: null, reason: `${share}% of the image uses colours that are not in the palette: ${off.map((c) => `${c.hex} (nearest ${c.nearest.name} ${c.nearest.hex}, ΔE ${c.nearest.distance.toFixed(0)})`).join('; ')}.`, swatches: off.map((c) => ({ hex: c.hex, nearest: c.nearest.hex, name: c.nearest.name })) }));
    }
  }
  if (active(ws, 'ACC-02')) {
    let ratio = null, fg = null, bg = null, how = '';
    if (aiImage?.textColorHex && aiImage?.backgroundColorHex && /^#?[0-9a-f]{6}$/i.test(aiImage.textColorHex.replace('#', '')) && /^#?[0-9a-f]{6}$/i.test(aiImage.backgroundColorHex.replace('#', ''))) {
      fg = '#' + aiImage.textColorHex.replace('#', '').toUpperCase();
      bg = '#' + aiImage.backgroundColorHex.replace('#', '').toUpperCase();
      ratio = contrastRatio(fg, bg);
      how = 'Text and background colours read by the AI; the ratio is computed with the WCAG formula.';
    } else if (analysis?.estimatedContrast) {
      ({ ratio, fg, bg } = analysis.estimatedContrast);
      how = 'Estimated from the two most contrasting dominant colours.';
    }
    if (ratio && ratio < 4.5) {
      out.push(finding(ws, { ruleId: 'ACC-02', target: 'image', title: `Low text contrast (${ratio.toFixed(2)}:1)`, quote: null, start: null, end: null, reason: `Text ${fg} on ${bg} gives ${ratio.toFixed(2)}:1; WCAG AA needs 4.5:1. ${how}`, swatches: [{ hex: fg }, { hex: bg }], aiAssisted: how.startsWith('Text and'), model: aiImage?.model, confidence: how.startsWith('Estimated') ? 0.7 : 0.85 }));
    }
  }
  return out;
}
