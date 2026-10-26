// GET /api/health: tells the app whether AI checks are configured (never exposes the key).
import { aiConfigured, modelCandidates } from './_lib/gemini.js';

export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ ok: true, ai: aiConfigured(), provider: 'Google Gemini', model: process.env.MOCK_AI === '1' ? 'mock-model' : modelCandidates()[0] }));
}
