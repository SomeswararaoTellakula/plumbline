// Workspace state. Each visitor gets their own copy of the demo workspace, kept in this browser,
// so judges never overwrite each other's work and no sign-in is needed.
import { seedWorkspace, ACTORS } from './seed.js';
import { locate, hashString } from './lib/text.js';
import { runDeterministic } from './checks/engine.js';

const KEY = 'plumbline.workspace.v2';
const PREFS = 'plumbline.prefs.v1';
const listeners = new Set();

export let ws = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 2 && Array.isArray(parsed.drafts)) return parsed;
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return seedWorkspace();
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(ws));
  } catch {
    notify('storage-full');
  }
  for (const fn of listeners) fn();
}

export function onChange(fn) { listeners.add(fn); }
function notify(kind) { for (const fn of listeners) fn(kind); }

export function resetWorkspace() {
  ws = seedWorkspace();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  save();
}

export function prefs() {
  try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; }
}
export function setPref(k, v) {
  const p = prefs();
  p[k] = v;
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* ignore */ }
}

export function actor() { return ACTORS[ws.role] || ACTORS.creator; }
export function setRole(role) {
  if (!ACTORS[role]) return;
  ws.role = role;
  save();
}

export function uid(prefix) {
  ws.seq = (ws.seq || 100) + 1;
  return `${prefix}-${ws.seq}`;
}

export function log(action, draftId = null, detail = '') {
  const a = actor();
  ws.audit.unshift({ at: new Date().toISOString(), actor: a.name, role: a.role, action, draftId, detail });
  if (ws.audit.length > 500) ws.audit.length = 500;
}

export function getDraft(id) { return ws.drafts.find((d) => d.id === id); }
export function rule(id) { return ws.rules.find((r) => r.id === id); }
export function fact(id) { return ws.facts.find((f) => f.id === id); }

export const OPEN = (f) => f.status === 'open';
export function openFindings(d) { return (d.findings || []).filter(OPEN); }
export function countBySeverity(list) {
  const c = { blocker: 0, high: 0, medium: 0, low: 0 };
  for (const f of list) c[f.severity] = (c[f.severity] || 0) + 1;
  return c;
}

export function contentHash(d) { return hashString(d.body + '|' + (d.image?.src || '') + '|' + (d.image?.alt || '')); }

// ---- Permissions -------------------------------------------------------------------------
export function canEdit(d) {
  return ['creator', 'manager'].includes(ws.role) && ['draft', 'changes_requested'].includes(d.status);
}
export function canDecide(d) {
  return ['reviewer', 'manager'].includes(ws.role) && d.status === 'in_review';
}
export function canOverride(d) {
  return ws.role === 'manager' && d.status !== 'approved';
}
export function canEditKit() { return ws.role === 'manager'; }

/** Why the current role cannot submit (or null if it can). */
export function submitBlockers(d) {
  if (!canEdit(d)) return null;
  if (d.needsReview || !d.lastReview) return 'Run a review on the current version first.';
  if (d.lastReview?.ai === 'running') return 'Wait for the review to finish.';
  const blockers = openFindings(d).filter((f) => f.severity === 'blocker');
  if (blockers.length) return `Resolve ${blockers.length} blocker${blockers.length > 1 ? 's' : ''} first (accept a fix, edit the text, or ask a Brand Manager to override).`;
  return '';
}
export function approveBlockers(d) {
  const blockers = openFindings(d).filter((f) => f.severity === 'blocker');
  if (blockers.length) return `${blockers.length} blocker${blockers.length > 1 ? 's are' : ' is'} still open. Request changes, or a Brand Manager can override with a reason.`;
  return '';
}

// ---- Content changes ---------------------------------------------------------------------
function pushVersion(d, note) {
  const n = (d.versions.at(-1)?.n || 0) + 1;
  d.versions.push({ n, body: d.body, at: new Date().toISOString(), by: actor().name, note });
  d.updatedAt = new Date().toISOString();
}

/** Re-anchor open findings after the text changed; those whose text is gone become stale. */
function reanchor(d) {
  for (const f of d.findings) {
    if (f.target !== 'text' || f.quote == null || f.status !== 'open') continue;
    const loc = locate(d.body, f.quote, f.start ?? 0);
    if (loc) { f.start = loc.start; f.end = loc.end; f.stale = false; }
    else { f.stale = true; f.start = null; f.end = null; }
  }
}

/**
 * Put a replacement in place and tidy only the seams it creates (double spaces, a space before
 * punctuation, doubled sentence punctuation). Text elsewhere is never touched, so accepting one fix
 * cannot silently change another part of the draft.
 */
function joinEdit(before, replacement, after) {
  let left = before;
  let mid = replacement;
  let right = after;
  if (/\s$/.test(left) && /^\s/.test(mid)) mid = mid.replace(/^\s+/, '');
  left += mid;
  if (/\s$/.test(left) && /^\s/.test(right)) right = right.replace(/^[ \t]+/, '');
  if (/^[,.!?;:]/.test(right)) left = left.replace(/[ \t]+$/, '');
  if (/[.!?]$/.test(left) && right[0] === left.at(-1)) right = right.slice(1);
  if (/^\s*$/.test(left) ) right = right.replace(/^\s+/, '');
  return (left + right).replace(/^\s+|\s+$/g, '');
}

export function applyFix(d, f, replacement, edited = false) {
  if (f.fix?.kind === 'alt' || (f.ruleId === 'ACC-01' && f.target === 'image')) {
    d.image.alt = replacement;
    f.status = edited ? 'edited' : 'accepted';
    f.resolution = { by: actor().name, at: new Date().toISOString(), reason: '', text: replacement };
    d.updatedAt = new Date().toISOString();
    log(edited ? 'Edited and applied fix' : 'Accepted fix', d.id, `${f.ruleId}: alt text added`);
    save();
    return true;
  }
  if (f.fix?.kind === 'append') {
    d.body = `${d.body.trimEnd()} ${replacement.trim()}`;
    f.status = edited ? 'edited' : 'accepted';
    f.resolution = { by: actor().name, at: new Date().toISOString(), reason: '', text: replacement };
    pushVersion(d, `${edited ? 'Edited fix' : 'Accepted fix'} for ${f.ruleId}`);
    reanchor(d);
    log(edited ? 'Edited and applied fix' : 'Accepted fix', d.id, `${f.ruleId}: added "${replacement}"`);
    save();
    return true;
  }
  const loc = locate(d.body, f.quote, f.start ?? 0);
  if (!loc) return false;
  const before = d.body.slice(0, loc.start);
  const after = d.body.slice(loc.end);
  d.body = joinEdit(before, replacement, after);
  f.status = edited ? 'edited' : 'accepted';
  f.resolution = { by: actor().name, at: new Date().toISOString(), reason: '', text: replacement };
  pushVersion(d, `${edited ? 'Edited fix' : 'Accepted fix'} for ${f.ruleId}`);
  reanchor(d);
  if (f.factId && f.verdict === 'contradicted') d.supported = [...(d.supported || []), { quote: replacement, factId: f.factId }];
  log(edited ? 'Edited and applied fix' : 'Accepted fix', d.id, `${f.ruleId}: "${f.quote}" → "${replacement || '(removed)'}"`);
  save();
  return true;
}

export function dismissFinding(d, f, reason, kind = 'dismissed') {
  f.status = kind;
  f.resolution = { by: actor().name, at: new Date().toISOString(), reason };
  log(kind === 'overridden' ? 'Overrode blocker' : 'Dismissed finding', d.id, `${f.ruleId}: ${reason}`);
  save();
}

export function editBody(d, body) {
  if (body === d.body) return;
  d.body = body;
  d.needsReview = true;
  pushVersion(d, 'Edited text');
  reanchor(d);
  log('Edited text', d.id, `Version ${d.versions.at(-1).n}`);
  save();
}

export function setImage(d, image) {
  d.image = image;
  d.needsReview = true;
  d.findings = d.findings.filter((f) => f.target !== 'image');
  d.updatedAt = new Date().toISOString();
  log(image ? 'Changed image' : 'Removed image', d.id, image?.name || '');
  save();
}

export function setAlt(d, alt) {
  if (!d.image) return;
  d.image.alt = alt;
  const f = d.findings.find((x) => x.ruleId === 'ACC-01' && x.status === 'open');
  if (f && alt.trim()) { f.status = 'edited'; f.resolution = { by: actor().name, at: new Date().toISOString(), reason: '', text: alt }; }
  log('Updated alt text', d.id, alt.slice(0, 80));
  save();
}

// ---- Workflow ---------------------------------------------------------------------------
export function submit(d) {
  d.status = 'in_review';
  d.updatedAt = new Date().toISOString();
  const open = openFindings(d).length;
  log('Submitted for review', d.id, open ? `${open} non-blocking finding${open > 1 ? 's' : ''} left open` : 'All findings resolved');
  save();
}

export function approve(d, note) {
  d.status = 'approved';
  d.approvedBy = actor().name;
  d.approvedAt = new Date().toISOString();
  // The facts the approved text relies on: claims supported now, re-checked on the final text,
  // plus earlier supported claims whose words are still in it.
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const current = runDeterministic(ws, d.body, today).supported || [];
  const kept = (d.supported || []).filter((s) => s.quote && d.body.includes(s.quote));
  d.factRefs = [...new Set([...kept, ...current].map((s) => s.factId).filter(Boolean))].sort();
  if (note) d.comments.push({ id: uid('C'), by: actor().name, role: ws.role, text: note, at: new Date().toISOString() });
  log('Approved', d.id, d.factRefs.length ? `Relies on ${d.factRefs.join(', ')}` : '');
  save();
}

export function requestChanges(d, note) {
  d.status = 'changes_requested';
  d.updatedAt = new Date().toISOString();
  d.comments.push({ id: uid('C'), by: actor().name, role: ws.role, text: note, at: new Date().toISOString() });
  log('Requested changes', d.id, note.slice(0, 120));
  save();
}

export function reopen(d) {
  d.status = 'draft';
  d.approvedBy = null;
  d.approvedAt = null;
  log('Reopened for edits', d.id, '');
  save();
}

export function addComment(d, text) {
  d.comments.push({ id: uid('C'), by: actor().name, role: ws.role, text, at: new Date().toISOString() });
  log('Commented', d.id, text.slice(0, 120));
  save();
}

export function createDraft({ title, channel, body, image }) {
  const id = uid('D');
  const now = new Date().toISOString();
  const d = { id, title, channel, author: actor().name, status: 'draft', createdAt: now, updatedAt: now, body, image: image || null, versions: [{ n: 1, body, at: now, by: actor().name, note: 'Created' }], findings: [], comments: [], factRefs: [], supported: [], needsReview: true, lastReview: null, approvedBy: null, approvedAt: null };
  ws.drafts.unshift(d);
  log('Created draft', id, title);
  save();
  return d;
}

export function deleteDraft(d) {
  ws.drafts = ws.drafts.filter((x) => x.id !== d.id);
  log('Deleted draft', d.id, d.title);
  save();
}
