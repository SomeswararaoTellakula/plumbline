// Run with: npm test   (Node's built-in test runner, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedWorkspace } from '../js/seed.js';
import { runDeterministic, mergeAI, imageFindings, imageTextFindings } from '../js/checks/engine.js';
import { parseQuantities, sentences, locate } from '../js/lib/text.js';
import { compareQuantity } from '../js/checks/claims.js';
import { validateFix } from '../js/checks/validate.js';
import { contrastRatio, deltaE2000, rgbToLab, hexToRgb, kmeans } from '../js/lib/color.js';
import { diffWords } from '../js/lib/diff.js';

const TODAY = '2026-10-26';
const ws = seedWorkspace(new Date('2026-10-26T12:00:00Z'));
const draft = (id) => ws.drafts.find((d) => d.id === id);
const rules = (findings) => findings.map((f) => f.ruleId);

test('parses Indian number formats, units and qualifiers', () => {
  const q = parseQuantities('trusted by 5 million users, over 2,50,000 merchants, up to ₹100 cashback, rated 4.6 out of 5, in 2 seconds');
  const byRaw = Object.fromEntries(q.map((x) => [x.raw, x]));
  assert.equal(byRaw['5 million'].value, 5e6);
  assert.equal(byRaw['2,50,000'].value, 250000);
  assert.equal(byRaw['2,50,000'].qualifier, 'atLeast');
  assert.equal(byRaw['₹100'].unitType, 'currency');
  assert.equal(byRaw['₹100'].qualifier, 'upTo');
  assert.equal(byRaw['4.6'].unitType, 'rating');
  assert.equal(byRaw['2'].unitType, 'seconds');
});

test('comparator respects qualifiers', () => {
  const fact = { value: 4.2e6, unitType: 'count', qualifier: 'exact' };
  assert.equal(compareQuantity({ value: 5e6, unitType: 'count', qualifier: 'exact' }, fact), false);
  assert.equal(compareQuantity({ value: 4e6, unitType: 'count', qualifier: 'atLeast' }, fact), true);
  const cashback = { value: 100, unitType: 'currency', qualifier: 'upTo' };
  assert.equal(compareQuantity({ value: 200, unitType: 'currency', qualifier: 'exact' }, cashback), false);
  assert.equal(compareQuantity({ value: 100, unitType: 'currency', qualifier: 'upTo' }, cashback), true);
  assert.equal(compareQuantity({ value: 5, unitType: 'seconds', qualifier: 'under' }, { value: 2, unitType: 'seconds', qualifier: 'approx' }), true);
});

test('Diwali post: catches the planted problems', () => {
  const { findings } = runDeterministic(ws, draft('D-101').body, TODAY);
  const ids = rules(findings);
  for (const id of ['TRM-01', 'CLM-02', 'CLM-01', 'TON-01', 'CLM-03', 'TON-03', 'TRM-02', 'LEG-01']) assert.ok(ids.includes(id), `missing ${id}: ${ids.join(', ')}`);
  const users = findings.find((f) => f.ruleId === 'CLM-01' && /million/.test(f.quote));
  assert.equal(users.severity, 'blocker');
  assert.equal(users.factId, 'F-001');
  assert.match(users.fix.replacement, /4\.2 million/);
  const cash = findings.find((f) => f.ruleId === 'CLM-01' && /₹200/.test(f.quote));
  assert.equal(cash.factId, 'F-004');
  assert.match(cash.fix.replacement, /up to ₹100/);
});

test('blog intro: expired merchant fact is outdated, supported facts pass, long sentence flagged', () => {
  const { findings, supported } = runDeterministic(ws, draft('D-102').body, TODAY);
  const outdated = findings.find((f) => f.ruleId === 'CLM-04');
  assert.ok(outdated, rules(findings).join(', '));
  assert.equal(outdated.factId, 'F-005');
  assert.ok(supported.some((s) => s.factId === 'F-007'), JSON.stringify(supported));
  assert.ok(supported.some((s) => s.factId === 'F-006'), JSON.stringify(supported));
  assert.ok(rules(findings).includes('TON-04'));
});

test('push notification: confidential project and brand casing', () => {
  const { findings } = runDeterministic(ws, draft('D-103').body, TODAY);
  const ids = rules(findings);
  assert.ok(ids.includes('CNF-01'));
  assert.ok(ids.includes('TRM-01'));
});

test('approved items stay clean', () => {
  assert.equal(runDeterministic(ws, draft('D-105').body, TODAY).findings.length, 0);
  assert.equal(runDeterministic(ws, draft('D-104').body, TODAY).findings.length, 0);
});

test('validator rejects rewrites that invent numbers or rankings', () => {
  const fact = ws.facts.find((f) => f.id === 'F-001');
  assert.equal(validateFix({ replacement: 'trusted by 4.2 million users', original: 'trusted by 5 million users', sentence: '', fact }).ok, true);
  assert.equal(validateFix({ replacement: 'trusted by 6 million users', original: 'trusted by 5 million users', sentence: '', fact }).ok, false);
  assert.equal(validateFix({ replacement: "India's best app", original: 'a payments app', sentence: '', fact: null }).ok, false);
});

test('AI merge: comparator wins on numbers, bad AI rewrites are rejected, tone issues added', () => {
  const text = draft('D-101').body;
  const det = runDeterministic(ws, text, TODAY);
  const ai = {
    model: 'test-model',
    claims: [
      { quote: '5 million users', claimType: 'numeric', verdict: 'supported', factId: 'F-001', confidence: 0.9, explanation: 'ok', suggestedRewrite: '9 million users' },
      { quote: 'send money home in seconds', claimType: 'implied', verdict: 'supported', factId: 'F-002', confidence: 0.8, explanation: 'fine', suggestedRewrite: '' },
    ],
    issues: [{ quote: 'download now before the offer ends', ruleId: 'TON-02', title: 'Pressure to act', explanation: 'Creates urgency.', suggestedRewrite: 'download NimbuPay today', confidence: 0.8 }],
    keyMessagesCovered: ['Fast'],
  };
  const merged = mergeAI(ws, text, det, ai, TODAY);
  const users = merged.findings.find((f) => f.ruleId === 'CLM-01' && /million/.test(f.quote));
  assert.equal(users.verdict, 'contradicted');
  assert.ok(users.rejectedFix, 'the invented 9 million rewrite should be rejected');
  assert.match(users.fix.replacement, /4\.2 million/);
  assert.ok(merged.findings.some((f) => f.ruleId === 'TON-02' && f.aiAssisted));
  assert.ok(merged.supported.some((s) => s.factId === 'F-002'));
});

test('image checks: missing alt text, off-palette colours and low contrast', () => {
  const analysis = { clusters: [{ hex: '#FF5FA2', share: 0.8 }, { hex: '#FFFFFF', share: 0.2 }], estimatedContrast: { ratio: contrastRatio('#FFFFFF', '#FF5FA2'), fg: '#FFFFFF', bg: '#FF5FA2' } };
  const f = imageFindings(ws, { alt: '' }, analysis, null);
  assert.deepEqual(rules(f).sort(), ['ACC-01', 'ACC-02', 'VIS-01']);
  const fromAi = imageTextFindings(ws, 'Get ₹200 cashback on your first payment', TODAY);
  assert.ok(fromAi.some((x) => x.ruleId === 'CLM-01' && x.target === 'image'));
});

test('colour maths', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 0.01);
  assert.ok(deltaE2000(rgbToLab(hexToRgb('#1F4D2B')), rgbToLab(hexToRgb('#1F4D2B'))) < 1e-9);
  const px = [...Array(80).fill([255, 0, 0]), ...Array(20).fill([0, 0, 255])];
  const c = kmeans(px, 3);
  assert.equal(c[0].hex, '#FF0000');
  assert.ok(Math.abs(c[0].share - 0.8) < 1e-9);
});

test('text helpers', () => {
  assert.equal(sentences('One. Two! Three?').length, 3);
  assert.deepEqual(locate('a b a', 'a', 4), { start: 4, end: 5 });
  const d = diffWords('pay with Nimbupay now', 'pay with NimbuPay now');
  assert.ok(d.some((p) => p.type === 'del' && p.text.includes('Nimbupay')));
});
