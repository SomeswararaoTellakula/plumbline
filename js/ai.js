// Browser side of the AI calls. The key lives on the server; the browser only talks to /api/*.
export const aiState = { checked: false, available: false, model: '', provider: 'Google Gemini' };

export async function checkHealth() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error('no api');
    const j = await res.json();
    Object.assign(aiState, { checked: true, available: Boolean(j.ai), model: j.model || '', provider: j.provider || 'Google Gemini' });
  } catch {
    Object.assign(aiState, { checked: true, available: false, model: '' });
  }
  return aiState;
}

async function post(path, body, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.message || `Request failed (${res.status})`), { code: j.error || res.status });
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('The AI check took too long, so only rule-based checks ran.'), { code: 'TIMEOUT' });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function aiReview(ws, draft, today) {
  return post('api/review', {
    text: draft.body,
    channel: draft.channel,
    brand: ws.brand.name,
    today,
    rules: ws.rules.map(({ id, title, description, category, active, engine }) => ({ id, title, description, category, active, engine })),
    tone: { voice: ws.tone.voice, do: ws.tone.do, dont: ws.tone.dont, keyMessages: ws.tone.keyMessages },
    facts: ws.facts.map(({ id, statement, metric, keywords, expires, confidential }) => ({ id, statement, metric, keywords, expires, confidential })),
    confidentialTerms: ws.tone.confidentialTerms || [],
  });
}

export function aiAltText(dataUrl) {
  return post('api/alt-text', { image: dataUrl });
}

export function aiImportKit(text, confidentialTerms) {
  return post('api/import-kit', { text, confidentialTerms }, 90000);
}
