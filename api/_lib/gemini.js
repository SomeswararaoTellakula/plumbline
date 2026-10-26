// Provider adapter for Google Gemini (REST, no SDK).
// The key is read from the GEMINI_API_KEY environment variable and never leaves the server.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class AIError extends Error {
  constructor(code, status, publicMessage) {
    super(publicMessage);
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

// Models sometimes write characters such as ₹ as the literal text "\\u20b9" inside a JSON string.
function unescapeDeep(v) {
  if (typeof v === 'string') return v.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (Array.isArray(v)) return v.map(unescapeDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unescapeDeep(x)]));
  return v;
}

export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY) || process.env.MOCK_AI === '1';
}

// gemini-2.5-flash first (fast with thinking off), then lighter and newer fallbacks.
export function modelCandidates() {
  return [...new Set([process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'].filter(Boolean))];
}

// Models that just failed (overloaded, rate-limited, timed out, missing) are tried last for a while,
// so the next request on this instance goes straight to a model that is answering.
const coolingUntil = new Map();
function coolDown(model, ms) { coolingUntil.set(model, Date.now() + ms); }
export function orderedModels(now = Date.now()) {
  const all = modelCandidates();
  const ready = all.filter((m) => !(coolingUntil.get(m) > now));
  return [...ready, ...all.filter((m) => !ready.includes(m))];
}
export function _resetHealth() { coolingUntil.clear(); }

const BUSY = 'The AI service is busy right now, so only rule-based checks ran. Try again in a minute.';

/**
 * Ask Gemini for JSON that matches `schema`. Tries the configured model, then fallbacks, within `deadline`
 * (an absolute time in ms) so the whole request finishes before the serverless time limit.
 * Overloaded (5xx), rate-limited (429), slow or missing models fall through to the next model.
 * Returns { data, model }.
 */
export async function generateJSON({ system, parts, schema, temperature = 0.2, attemptMs = 20000, deadline = Date.now() + 50000, mock }) {
  if (process.env.MOCK_AI === '1' && mock) return { data: mock(), model: 'mock-model' };
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIError('AI_NOT_CONFIGURED', 503, 'AI checks are not configured on this deployment, so only rule-based checks ran.');
  let lastError = null;
  let rateLimited = false;
  for (const model of orderedModels()) {
    for (const auth of ['header', 'bearer']) {
      const remaining = deadline - Date.now();
      if (remaining < 2500) {
        throw lastError?.code === 'AI_AUTH' ? lastError : new AIError('AI_TIMEOUT', 504, 'The AI service did not answer in time, so only rule-based checks ran.');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(attemptMs, remaining - 500));
      let res;
      try {
        res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(auth === 'header' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` }) },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema, ...(/2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
          }),
        });
      } catch (e) {
        clearTimeout(timer);
        coolDown(model, 90_000);
        lastError = new AIError('AI_TIMEOUT', 504, 'The AI service did not answer in time, so only rule-based checks ran.');
        break;
      }
      clearTimeout(timer);
      if (res.status === 404) { coolDown(model, 60 * 60_000); lastError = new AIError('AI_MODEL_NOT_FOUND', 502, `Model ${model} is not available.`); break; }
      if ((res.status === 401 || res.status === 403) && auth === 'header') { lastError = new AIError('AI_AUTH', 502, 'The AI key was rejected.'); continue; }
      if (res.status === 429) { rateLimited = true; coolDown(model, 60_000); lastError = new AIError('AI_RATE_LIMIT', 429, BUSY); break; }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        if (res.status >= 500) coolDown(model, 90_000);
        lastError = new AIError('AI_HTTP_' + res.status, 502, res.status >= 500 ? BUSY : `The AI service returned an error (${res.status}).`);
        lastError.detail = detail;
        break;
      }
      const json = await res.json().catch(() => ({}));
      const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) { lastError = new AIError('AI_EMPTY', 502, 'The AI returned an empty answer.'); break; }
      try {
        return { data: unescapeDeep(JSON.parse(text)), model };
      } catch {
        lastError = new AIError('AI_BAD_JSON', 502, 'The AI answer was not valid JSON.');
        break;
      }
    }
  }
  if (rateLimited && lastError?.code !== 'AI_AUTH') throw new AIError('AI_RATE_LIMIT', 429, BUSY);
  throw lastError || new AIError('AI_ERROR', 502, 'The AI check failed.');
}
