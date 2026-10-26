// Resilience of the Gemini adapter and the review API when the AI service is busy, slow or rate-limited.
// The network is replaced by a fake fetch, so these tests need no key and make no real calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateJSON, orderedModels, _resetHealth } from '../api/_lib/gemini.js';
import reviewHandler from '../api/review.js';
import { seedWorkspace } from '../js/seed.js';

process.env.GEMINI_API_KEY = 'test-key-not-real';
delete process.env.MOCK_AI;
delete process.env.GEMINI_MODEL;

const realFetch = globalThis.fetch;
const modelOf = (url) => decodeURIComponent(String(url).split('/models/')[1].split(':')[0]);
const ok = (obj) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });

function fakeFetch(plan) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const model = modelOf(url);
    calls.push(model);
    return plan(model, init, calls.length);
  };
  return calls;
}

test.afterEach(() => { globalThis.fetch = realFetch; _resetHealth(); });

test('an overloaded model falls through to the next one, which is then tried first', async () => {
  const calls = fakeFetch((model) => (model === 'gemini-2.5-flash' ? new Response('{"error":"overloaded"}', { status: 503 }) : ok({ x: 1 })));
  const r = await generateJSON({ system: 's', parts: [{ text: 'p' }], schema: {} });
  assert.deepEqual(r.data, { x: 1 });
  assert.equal(r.model, 'gemini-2.5-flash-lite');
  assert.deepEqual(calls, ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  assert.equal(orderedModels()[0], 'gemini-2.5-flash-lite');
});

test('a rate limit on one model tries the others; all rate-limited gives a clear 429', async () => {
  const calls = fakeFetch(() => new Response('{}', { status: 429 }));
  await assert.rejects(generateJSON({ system: 's', parts: [{ text: 'p' }], schema: {} }), (e) => e.status === 429 && /busy/.test(e.publicMessage));
  assert.equal(calls.length, 3);
});

test('a model that hangs is abandoned in time and the next model answers', async () => {
  fakeFetch((model, init) => (model === 'gemini-2.5-flash'
    ? new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    : ok({ y: 2 })));
  const t0 = Date.now();
  const r = await generateJSON({ system: 's', parts: [{ text: 'p' }], schema: {}, attemptMs: 200 });
  assert.equal(r.model, 'gemini-2.5-flash-lite');
  assert.ok(Date.now() - t0 < 2000);
});

test('the shared deadline is respected even when every model hangs', async () => {
  fakeFetch((model, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const t0 = Date.now();
  await assert.rejects(generateJSON({ system: 's', parts: [{ text: 'p' }], schema: {}, deadline: Date.now() + 3200 }), (e) => e.status === 504);
  assert.ok(Date.now() - t0 < 4000);
});

function call(handler, body) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k] = v; },
      end: (text) => resolve({ status: res.statusCode, body: JSON.parse(text) }),
    };
    handler({ method: 'POST', headers: { 'x-forwarded-for': 'test-' + Math.random() }, body }, res);
  });
}

test('review keeps tone results when claim verification fails, and says so', async () => {
  const ws = seedWorkspace();
  const d = ws.drafts.find((x) => x.id === 'D-101');
  const quote = 'download now before the offer ends';
  fakeFetch((model, init) => {
    const prompt = JSON.parse(init.body).systemInstruction.parts[0].text;
    if (/fact ledger/.test(prompt)) return new Response('{}', { status: 503 });
    return ok({ claims: [{ quote: '5 million users', claimType: 'numeric' }], issues: [{ quote, ruleId: 'TON-02', title: 'Pressure', explanation: 'Rushes the reader (TON-02).', suggestedRewrite: 'download NimbuPay to try it', confidence: 0.8 }], keyMessagesCovered: [] });
  });
  const r = await call(reviewHandler, { text: d.body, brand: 'NimbuPay', today: '2026-10-26', rules: ws.rules, tone: ws.tone, facts: ws.facts, confidentialTerms: ws.tone.confidentialTerms });
  assert.equal(r.status, 200);
  assert.equal(r.body.issues.length, 1);
  assert.equal(r.body.claims.length, 0);
  assert.match(r.body.warning, /verification did not finish/);
});
