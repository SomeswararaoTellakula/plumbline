// Brand Kit: the approved source of truth that every review is checked against.
import { ws, canEditKit } from '../store.js';
import { esc, sevChip, fmtDate } from '../ui.js';
import { aiState } from '../ai.js';
import { ui } from '../state.js';
import { todayISO } from '../review.js';

const TABS = [['rules', 'Rules'], ['terms', 'Terminology'], ['facts', 'Fact ledger'], ['look', 'Palette & tone'], ['import', 'Import from brand guide']];
const ENGINE = { rule: 'Rule-based', ai: 'AI-assisted', hybrid: 'Rule + AI' };

export function renderKit() {
  const tab = ui.kitTab || 'rules';
  const editable = canEditKit();
  return `
  <div class="page-head">
    <div><h1>${esc(ws.brand.name)} Brand Kit</h1><p>The approved rules, terms, facts and assets every draft is checked against.</p></div>
    ${editable ? '' : '<div class="notice info small">Read-only. Switch <b>Acting as</b> to Meera (Brand Manager) to edit the Brand Kit.</div>'}
  </div>
  <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-action="kit-tab" data-tab="${k}">${l}${k === 'rules' ? `<span class="n">${ws.rules.length}</span>` : k === 'facts' ? `<span class="n">${ws.facts.length}</span>` : k === 'terms' ? `<span class="n">${ws.terms.length}</span>` : ''}</button>`).join('')}</div>
  ${({ rules, terms, facts, look, import: importTab })[tab](editable)}`;
}

function rules(editable) {
  const usage = flagCounts();
  return `<div class="card">
    ${editable ? '<div class="card-pad row" style="justify-content:space-between"><span class="muted small">Inactive rules are skipped in reviews. New rules you add here are judged by the AI.</span><button class="btn small primary" data-action="add-rule">+ Add rule</button></div>' : ''}
    <table class="kit-table"><thead><tr><th>ID</th><th>Rule</th><th>Severity</th><th>How it is checked</th><th>Open flags</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
    ${ws.rules.map((r) => `<tr class="${r.active === false ? 'inactive' : ''}" id="rule-${esc(r.id)}">
      <td><span class="tag">${esc(r.id)}</span></td>
      <td><b>${esc(r.title)}</b><div class="muted small">${esc(r.category)} · ${esc(r.description)}</div>${r.example ? `<div class="small" style="margin-top:3px">Example: ${esc(r.example)}</div>` : ''}</td>
      <td>${sevChip(r.severity)}</td>
      <td class="small">${esc(ENGINE[r.engine] || r.engine)}</td>
      <td class="small">${usage[r.id] || '<span class="muted">0</span>'}</td>
      ${editable ? `<td class="row" style="flex-wrap:nowrap"><button class="btn small" data-action="edit-rule" data-rid="${esc(r.id)}">Edit</button><button class="btn small ghost" data-action="toggle-rule" data-rid="${esc(r.id)}">${r.active === false ? 'Activate' : 'Deactivate'}</button></td>` : ''}
    </tr>`).join('')}
    </tbody></table></div>`;
}

function flagCounts() {
  const c = {};
  for (const d of ws.drafts) for (const f of d.findings || []) if (f.status === 'open') c[f.ruleId] = (c[f.ruleId] || 0) + 1;
  return c;
}

function terms(editable) {
  const kinds = { banned: 'Banned', replace: 'Preferred term', competitor: 'Competitor name' };
  return `<div class="card">
    ${editable ? '<div class="card-pad row" style="justify-content:space-between"><span class="muted small">Terms are matched as whole words, ignoring case.</span><button class="btn small primary" data-action="add-term">+ Add term</button></div>' : ''}
    <table class="kit-table"><thead><tr><th>Term</th><th>Type</th><th>Use instead</th><th>Rule</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
    ${ws.terms.map((t) => `<tr><td><b>${esc(t.term)}</b></td><td>${esc(kinds[t.kind] || t.kind)}</td><td>${t.replacement ? esc(t.replacement) : '<span class="muted">Remove or rephrase</span>'}</td><td><span class="tag">${esc(t.ruleId)}</span></td>
      ${editable ? `<td><button class="btn small ghost" data-action="delete-term" data-tid="${esc(t.id)}">Delete</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}

function facts(editable) {
  const today = todayISO();
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const usedBy = (id) => ws.drafts.filter((d) => (d.status === 'approved' ? d.factRefs || [] : (d.supported || []).map((s) => s.factId)).includes(id));
  return `<div class="card">
    <div class="card-pad row" style="justify-content:space-between"><span class="muted small">Claims in drafts must match these facts. Expired facts make claims "outdated" until the owner confirms a new figure. Confidential facts are never sent to the AI.</span>${editable ? '<button class="btn small primary" data-action="add-fact">+ Add fact</button>' : ''}</div>
    <table class="kit-table"><thead><tr><th>ID</th><th>Approved statement</th><th>Source · owner</th><th>Expires</th><th>Used by</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
    ${ws.facts.map((f) => {
      const users = usedBy(f.id);
      const exp = f.expires ? (f.expires < today ? `<span class="badge-exp">Expired</span><br>${fmtDate(f.expires)}` : f.expires < soon ? `<span class="badge-soon">Soon</span><br>${fmtDate(f.expires)}` : fmtDate(f.expires)) : '<span class="muted">No expiry</span>';
      return `<tr id="fact-${esc(f.id)}" ${ui.highlightFact === f.id ? 'style="background:var(--brass-soft)"' : ''}>
        <td><span class="tag">${esc(f.id)}</span></td>
        <td>${esc(f.statement)} ${f.confidential ? '<span class="badge-conf">Confidential</span>' : ''}${f.quantity ? `<div class="muted small">Checked value: ${esc(f.display || f.quantity.value)} (${esc(f.quantity.unitType)}, ${esc(f.quantity.qualifier)})</div>` : ''}</td>
        <td class="small">${esc(f.source)}<br><span class="muted">${esc(f.owner)}</span></td>
        <td class="small">${exp}</td>
        <td class="small">${users.length ? users.map((d) => `<a href="#/draft/${esc(d.id)}">${esc(d.id)}</a>`).join(', ') : '<span class="muted">-</span>'}</td>
        ${editable ? `<td><button class="btn small" data-action="edit-fact" data-fact="${esc(f.id)}">Edit</button></td>` : ''}
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
}

function look(editable) {
  const list = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `<div class="stack">
    <section class="card card-pad"><div class="row" style="justify-content:space-between"><h2>Palette</h2>${editable ? '<button class="btn small" data-action="add-colour">+ Add colour</button>' : ''}</div>
      <p class="muted small">Large areas of colour in images must be within ΔE 12 (CIEDE2000) of one of these.</p>
      <div class="palette">${ws.palette.map((p) => `<div class="chip"><i style="background:${esc(p.hex)}"></i><div><b>${esc(p.name)}</b><br><span class="mono">${esc(p.hex)}</span></div></div>`).join('')}</div></section>
    <section class="card card-pad"><div class="row" style="justify-content:space-between"><h2>Tone of voice</h2>${editable ? '<button class="btn small" data-action="edit-tone">Edit tone</button>' : ''}</div>
      <p style="margin-top:8px">${esc(ws.tone.voice)}</p>
      <div class="tone-grid"><div><h3>Do</h3>${list(ws.tone.do)}</div><div><h3>Don't</h3>${list(ws.tone.dont)}</div><div><h3>Key messages</h3>${list(ws.tone.keyMessages)}</div></div></section>
    <section class="card card-pad"><h2>Confidential terms</h2><p class="muted small" style="margin-top:4px">Flagged as blockers if they appear in content, and redacted before any AI call.</p><p>${(ws.tone.confidentialTerms || []).map((t) => `<span class="badge-conf">${esc(t)}</span>`).join(' ') || '<span class="muted">None</span>'}</p></section>
  </div>`;
}

function importTab(editable) {
  if (!editable) return '<div class="card card-pad"><p>Only a Brand Manager can import guidelines. Switch <b>Acting as</b> to Meera (Brand Manager).</p></div>';
  const pending = ui.pendingImport;
  return `<div class="card card-pad stack">
    <div><h2>Draft rules from your brand guide</h2><p class="muted">Paste text from a brand-guide PDF or document. The AI proposes rules, terms and facts; nothing is added until you tick and confirm each one.</p></div>
    ${aiState.available ? '' : '<div class="notice warn">AI checks are not configured on this deployment, so import is unavailable. Rules can still be added by hand on the Rules tab.</div>'}
    <div class="field"><label for="import-text">Brand-guide text</label><textarea id="import-text" rows="8" placeholder="e.g. Always write our name as NimbuPay. Never call our product a 'super app'. Spell out numbers one to nine...">${esc(ui.importText || '')}</textarea></div>
    <div class="row"><button class="btn primary" data-action="run-import" ${aiState.available ? '' : 'disabled'}>${ui.importing ? '<span class="spinner"></span> Reading…' : 'Draft rules with AI'}</button><button class="btn ghost small" data-action="sample-import">Use a sample paragraph</button></div>
    ${pending ? `<form id="import-form">
      <h3>Proposed (${pending.rules.length + pending.terms.length + pending.facts.length}) · tick what to add</h3>
      ${pending.rules.map((r, i) => `<label class="row small" style="font-weight:400;align-items:flex-start;margin:8px 0"><input type="checkbox" name="rule-${i}" checked> <span><b>Rule:</b> ${esc(r.title)} ${sevChip(r.severity)} <span class="muted">(${esc(r.category)})</span><br>${esc(r.description)}<br><span class="muted">From: “${esc(r.sourceQuote)}”</span></span></label>`).join('')}
      ${pending.terms.map((t, i) => `<label class="row small" style="font-weight:400;margin:8px 0"><input type="checkbox" name="term-${i}" checked> <span><b>Term:</b> “${esc(t.term)}” (${esc(t.kind)})${t.replacement ? ` → “${esc(t.replacement)}”` : ''}</span></label>`).join('')}
      ${pending.facts.map((f, i) => `<label class="row small" style="font-weight:400;margin:8px 0"><input type="checkbox" name="fact-${i}" checked> <span><b>Fact:</b> ${esc(f.statement)} <span class="muted">(${esc(f.source)})</span></span></label>`).join('')}
      <div class="row" style="margin-top:10px"><button type="button" class="btn primary" data-action="confirm-import">Add selected to the Brand Kit</button><button type="button" class="btn" data-action="discard-import">Discard</button></div>
    </form>` : ''}
  </div>`;
}
