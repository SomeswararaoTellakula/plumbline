// Runs a review: deterministic checks show instantly, AI-assisted checks are merged in when they return.
import { ws, save, log, countBySeverity } from './store.js';
import { runDeterministic, mergeAI, imageFindings, imageTextFindings, dedupe } from './checks/engine.js';
import { aiState, aiReview, aiAltText } from './ai.js';
import { analyzeImage, toDataUrl } from './image.js';

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Keep a person's earlier decision when the same finding comes back on a re-run. */
function carryOver(previous, next) {
  for (const f of next) {
    const prev = previous.find((p) => p.ruleId === f.ruleId && p.target === f.target && (p.quote || '') === (f.quote || '') && ['dismissed', 'overridden'].includes(p.status));
    if (prev) { f.status = prev.status; f.resolution = { ...prev.resolution, carried: true }; }
  }
  return next;
}

function number(list, draft) {
  let n = 0;
  return list.map((f) => ({ ...f, id: `${draft.id}-${++n}` }));
}

export async function runReview(draft, onUpdate = () => {}) {
  const today = todayISO();
  const previous = draft.findings || [];
  const startedAt = new Date().toISOString();
  const det = runDeterministic(ws, draft.body, today);

  let analysis = null;
  if (draft.image?.src) {
    try { analysis = await analyzeImage(draft.image.src); } catch { analysis = null; }
  }
  draft.imageAnalysis = analysis ? { clusters: analysis.clusters.slice(0, 6), estimatedContrast: analysis.estimatedContrast } : null;

  // 1. Instant, rule-based feedback.
  draft.findings = number(carryOver(previous, dedupe([...det.findings, ...imageFindings(ws, draft.image, analysis, null)])), draft);
  draft.supported = det.supported;
  draft.needsReview = false;
  draft.lastReview = { at: startedAt, ai: aiState.available ? 'running' : 'off', model: '', counts: countBySeverity(draft.findings.filter((f) => f.status === 'open')) };
  save();
  onUpdate();
  if (!aiState.available) {
    draft.lastReview.message = 'AI checks are not configured on this deployment, so only rule-based checks ran.';
    log('Ran review', draft.id, `${draft.findings.length} findings · rules only`);
    save();
    return;
  }

  // 2. AI-assisted checks, in parallel for text and image.
  const bodyAtStart = draft.body;
  const [textRes, imgRes] = await Promise.allSettled([
    aiReview(ws, draft, today),
    draft.image?.src ? toDataUrl(draft.image.src).then((url) => aiAltText(url, draft.image.name, /^assets\/[\w.-]+$/.test(draft.image.src) ? draft.image.src : '')) : Promise.resolve(null),
  ]);
  if (draft.body !== bodyAtStart) {
    // The text changed while the AI was working; its answer no longer matches the text.
    draft.lastReview = { ...draft.lastReview, ai: 'skipped', message: 'The text changed while AI checks were running. Run the review again to include them.' };
    save();
    onUpdate();
    return;
  }

  let merged = det;
  let aiStatus = 'ok';
  let message = '';
  let model = '';
  let privacy = null;
  let recordedAt = '';
  if (textRes.status === 'fulfilled') {
    merged = mergeAI(ws, draft.body, det, textRes.value, today);
    model = textRes.value.model;
    privacy = textRes.value.privacy;
    if (textRes.value.warning) message = textRes.value.warning;
    if (textRes.value.recorded) { recordedAt = textRes.value.recorded.at; message = textRes.value.recorded.note; }
  } else {
    aiStatus = 'failed';
    message = textRes.reason?.message || 'The AI check failed, so only rule-based checks ran.';
  }
  const aiImage = imgRes.status === 'fulfilled' ? imgRes.value : null;
  if (imgRes.status === 'rejected' && aiStatus === 'ok' && !message) message = `Image reading failed: ${imgRes.reason?.message || 'unknown error'}.`;
  if (aiImage) model = model || aiImage.model;
  draft.imageAi = aiImage ? { visibleText: aiImage.visibleText, model: aiImage.model, recordedAt: aiImage.recorded?.at || '' } : null;

  const all = dedupe([...merged.findings, ...imageFindings(ws, draft.image, analysis, aiImage), ...imageTextFindings(ws, aiImage?.visibleText, today, draft.body)]);
  draft.findings = number(carryOver(previous, all), draft);
  draft.supported = merged.supported;
  const open = draft.findings.filter((f) => f.status === 'open');
  draft.lastReview = { at: startedAt, ai: aiStatus, model, message, privacy, recordedAt, counts: countBySeverity(open) };
  log('Ran review', draft.id, `${draft.findings.length} findings (${draft.lastReview.counts.blocker} blockers) · ${aiStatus === 'ok' ? `rules + AI (${model})` : 'rules only'}`);
  save();
  onUpdate();
}
