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

export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY) || process.env.MOCK_AI === '1';
}

export function modelCandidates() {
  return [...new Set([process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean))];
}

/**
 * Ask Gemini for JSON that matches `schema`. Tries the configured model, then fallbacks.
 * Returns { data, model }.
 */
export async function generateJSON({ system, parts, schema, temperature = 0.2, timeoutMs = 28000, mock }) {
  if (process.env.MOCK_AI === '1' && mock) return { data: mock(), model: 'mock-model' };
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIError('AI_NOT_CONFIGURED', 503, 'AI checks are not configured on this deployment, so only rule-based checks ran.');
  let lastError = null;
  for (const model of modelCandidates()) {
    for (const auth of ['header', 'bearer']) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        lastError = new AIError('AI_TIMEOUT', 504, 'The AI service did not answer in time, so only rule-based checks ran.');
        break;
      }
      clearTimeout(timer);
      if (res.status === 404) { lastError = new AIError('AI_MODEL_NOT_FOUND', 502, `Model ${model} is not available.`); break; }
      if ((res.status === 401 || res.status === 403) && auth === 'header') { lastError = new AIError('AI_AUTH', 502, 'The AI key was rejected.'); continue; }
      if (res.status === 429) throw new AIError('AI_RATE_LIMIT', 429, 'The AI service is busy (rate limit). Rule-based checks still ran; try again in a minute.');
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        lastError = new AIError('AI_HTTP_' + res.status, 502, `The AI service returned an error (${res.status}).`);
        lastError.detail = detail;
        break;
      }
      const json = await res.json();
      const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new AIError('AI_EMPTY', 502, 'The AI returned an empty answer.');
      try {
        return { data: JSON.parse(text), model };
      } catch {
        throw new AIError('AI_BAD_JSON', 502, 'The AI answer was not valid JSON.');
      }
    }
  }
  throw lastError || new AIError('AI_ERROR', 502, 'The AI check failed.');
}
