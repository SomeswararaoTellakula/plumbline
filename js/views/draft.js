// The review desk for one draft: content with highlighted findings, the findings panel,
// the workflow bar, comments, version history and activity.
import { ws, getDraft, rule, fact, openFindings, countBySeverity, canEdit, canDecide, canOverride, submitBlockers, approveBlockers, actor } from '../store.js';
import { esc, statusPill, sevChip, countChips, timeAgo, fmtDate, fmtDateTime, SEVERITY } from '../ui.js';
import { diffWords } from '../lib/diff.js';
import { nearestPaletteColour, hexToRgb } from '../lib/color.js';
import { aiState } from '../ai.js';
import { ui } from '../state.js';
import { todayISO } from '../review.js';

const ORDER = { blocker: 0, high: 1, medium: 2, low: 3 };
const RESOLVED_LABEL = { accepted: 'Fix accepted', edited: 'Fix edited and applied', dismissed: 'Dismissed', overridden: 'Overridden' };

export function renderDraft(id) {
  const d = getDraft(id);
  if (!d) return `<div class="empty card"><h2>Draft not found</h2><p>It may have been deleted or the demo was reset.</p><a class="btn" href="#/">Back to the queue</a></div>`;
  return `
  <a class="crumb" href="#/">← Review queue</a>
  <div class="draft-head">
    <div>
      <h1>${esc(d.title)}</h1>
      <div class="meta">${statusPill(d.status)}<span>${esc(d.channel)}</span><span>·</span><span>by ${esc(d.author)}</span><span>·</span><span>version ${d.versions.at(-1)?.n || 1}</span><span>·</span><span class="mono">${esc(d.id)}</span></div>
    </div>
  </div>
  ${workflowBar(d)}
  <div class="layout">
    <div>
      ${contentCard(d)}
      ${subPanels(d)}
    </div>
    ${findingsPanel(d)}
  </div>`;
}

// ---- Workflow ----------------------------------------------------------------------------
function workflowBar(d) {
  const role = actor().role;
  const reviewing = ui.reviewing[d.id];
  const open = openFindings(d);
  const c = countBySeverity(open);
  let why = '', buttons = '';
  const lastRequest = [...d.comments].reverse().find((x) => x.role !== 'creator');
  let banner = '';
  if (d.status === 'changes_requested' && lastRequest) banner = `<div class="notice warn" style="margin-bottom:12px"><b>Changes requested by ${esc(lastRequest.by)}:</b> ${esc(lastRequest.text)}</div>`;

  if (d.status === 'draft' || d.status === 'changes_requested') {
    if (canEdit(d)) {
      const blocker = submitBlockers(d);
      if (!d.lastReview || d.needsReview) why = `<b>Next:</b> run a review of ${d.lastReview ? 'the edited text' : 'this draft'} against the Brand Kit.`;
      else if (blocker) why = `<b>Next:</b> ${esc(blocker)}`;
      else why = `<b>Ready to submit.</b> ${open.length ? `${open.length} non-blocking finding${open.length > 1 ? 's' : ''} still open; the reviewer will see ${open.length > 1 ? 'them' : 'it'}.` : 'All findings are resolved.'}`;
      buttons = `<button class="btn ${!d.lastReview || d.needsReview ? 'primary' : ''}" data-action="run-review" data-id="${d.id}" ${reviewing ? 'disabled' : ''}>${reviewing ? '<span class="spinner"></span> Reviewing…' : 'Run review'}</button>
        <button class="btn ${blocker === '' ? 'primary' : ''}" data-action="submit" data-id="${d.id}" ${blocker !== '' || reviewing ? 'disabled' : ''} title="${esc(blocker || 'Send to a reviewer')}">Submit for review</button>`;
    } else {
      why = `Waiting for <b>${esc(d.author)}</b> to work on this draft. Switch <b>Acting as</b> to Priya (Creator) to edit it.`;
    }
  } else if (d.status === 'in_review') {
    if (canDecide(d)) {
      const blocked = approveBlockers(d);
      why = blocked ? `<b>Your decision.</b> ${esc(blocked)}` : `<b>Your decision.</b> ${open.length ? `${open.length} non-blocking finding${open.length > 1 ? 's are' : ' is'} open: ${countText(c)}.` : 'All findings are resolved.'} Approve, or request changes with a comment.`;
      buttons = `<button class="btn good" data-action="approve" data-id="${d.id}" ${blocked ? 'disabled' : ''} title="${esc(blocked || 'Approve for publishing')}">Approve</button>
        <button class="btn danger" data-action="request-changes" data-id="${d.id}">Request changes</button>`;
    } else {
      why = `Submitted and waiting for a reviewer. Switch <b>Acting as</b> to Arjun (Reviewer) or Meera (Brand Manager) to decide.`;
    }
  } else if (d.status === 'approved') {
    const refs = (d.factRefs || []).map((id) => `<button class="tag" data-action="goto-fact" data-fact="${esc(id)}">${esc(id)}</button>`).join(' ');
    why = `<b>Approved by ${esc(d.approvedBy || '')}</b> ${d.approvedAt ? 'on ' + fmtDate(d.approvedAt) : ''}. Locked for publishing.${refs ? ` Relies on approved facts ${refs}.` : ''}`;
    if (role === 'manager') buttons = `<button class="btn" data-action="reopen" data-id="${d.id}">Reopen for edits</button>`;
  }
  return `${banner}<div class="card workflow"><div class="why">${why}</div><div class="row">${buttons}</div></div>`;
}

function countText(c) {
  return ['high', 'medium', 'low'].filter((k) => c[k]).map((k) => `${c[k]} ${SEVERITY[k].toLowerCase()}`).join(', ');
}

// ---- Content -----------------------------------------------------------------------------
function contentCard(d) {
  const editable = canEdit(d);
  let body;
  if (ui.editing && editable) {
    body = `<div class="editor">
      <label for="body-editor">Edit the text</label>
      <textarea id="body-editor" rows="10">${esc(d.body)}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-action="save-body" data-id="${d.id}">Save as new version</button><button class="btn" data-action="cancel-edit">Cancel</button><span class="muted small">Saving marks the draft for a fresh review.</span></div>
    </div>`;
  } else {
    body = `<div class="copy" id="copy">${highlight(d)}</div>`;
  }
  return `<section class="card content-card" aria-label="Content">
    <div class="content-head">
      <h2>Content</h2>
      <div class="row">
        ${editable && !ui.editing ? `<button class="btn small" data-action="edit-body">Edit text</button>` : ''}
        ${editable && !d.image ? `<label class="btn small" style="margin:0">Add image<input type="file" accept="image/png,image/jpeg,image/webp" data-action="add-image" data-id="${d.id}" hidden></label>` : ''}
      </div>
    </div>
    ${body}
    ${d.image ? imageCard(d, editable) : ''}
  </section>`;
}

function highlight(d) {
  const text = d.body;
  const marks = d.findings.filter((f) => f.status === 'open' && f.target === 'text' && f.start != null && f.end != null && !f.stale);
  if (!marks.length) return esc(text);
  const points = new Set([0, text.length]);
  for (const f of marks) { points.add(f.start); points.add(f.end); }
  const sorted = [...points].sort((a, b) => a - b);
  let out = '';
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i], e = sorted[i + 1];
    const seg = text.slice(s, e);
    const cover = marks.filter((f) => f.start <= s && f.end >= e);
    if (!cover.length) { out += esc(seg); continue; }
    cover.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    const top = cover[0];
    const active = cover.some((f) => f.id === ui.activeFinding);
    out += `<mark class="m-${top.severity}${active ? ' active' : ''}" data-action="focus-finding" data-fid="${esc(top.id)}" title="${esc(cover.map((f) => `${SEVERITY[f.severity]}: ${f.title}`).join('\n'))}">${esc(seg)}</mark>`;
  }
  return out;
}

function imageCard(d, editable) {
  const img = d.image;
  const analysis = d.imageAnalysis;
  const swatches = analysis?.clusters?.filter((c) => c.share >= 0.03).map((c) => {
    const near = nearestPaletteColour(hexToRgb(c.hex), ws.palette);
    const ok = near.distance <= 12;
    return `<span class="swatch" title="${Math.round(c.share * 100)}% of the image. Nearest palette colour: ${esc(near.name)} (ΔE ${near.distance.toFixed(1)})"><i style="background:${esc(c.hex)}"></i>${esc(c.hex)} ${ok ? '✓' : '✗'}</span>`;
  }).join('') || '';
  return `<div class="image-card">
    <div><img src="${esc(img.src)}" alt="${esc(img.alt || '')}"><div class="muted small" style="margin-top:6px">${esc(img.name || 'image')}</div></div>
    <div>
      <label for="alt-input">Alt text <span class="muted small">(read aloud by screen readers)</span></label>
      ${editable ? `<textarea id="alt-input" rows="2" placeholder="Describe what the image shows, including any text in it">${esc(img.alt || '')}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn small" data-action="save-alt" data-id="${d.id}">Save alt text</button>
        <label class="btn small" style="margin:0">Replace image<input type="file" accept="image/png,image/jpeg,image/webp" data-action="add-image" data-id="${d.id}" hidden></label>
        <button class="btn small ghost" data-action="remove-image" data-id="${d.id}">Remove</button></div>` : `<p class="small">${img.alt ? esc(img.alt) : '<span class="muted">No alt text.</span>'}</p>`}
      ${swatches ? `<div class="small muted" style="margin-top:12px">Dominant colours (✓ = in the brand palette)</div><div class="swatches">${swatches}</div>` : `<p class="muted small" style="margin-top:12px">Run a review to analyse colours and contrast.</p>`}
      ${d.imageAi?.visibleText ? `<div class="small muted" style="margin-top:12px">Text read from the image (AI)</div><p class="small" style="font-family:var(--serif)">“${esc(d.imageAi.visibleText)}”</p>` : ''}
    </div>
  </div>`;
}

// ---- Findings ----------------------------------------------------------------------------
function findingsPanel(d) {
  const reviewing = ui.reviewing[d.id];
  const all = [...(d.findings || [])].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || ORDER[a.severity] - ORDER[b.severity] || (a.start ?? 9e9) - (b.start ?? 9e9));
  const open = all.filter((f) => f.status === 'open');
  const resolved = all.filter((f) => f.status !== 'open');
  const filter = ui.findingsFilter;
  const list = filter === 'open' ? open : filter === 'resolved' ? resolved : all;
  const lr = d.lastReview;
  let line = '';
  if (reviewing === 'rules') line = '<span class="spinner"></span> Running rule checks…';
  else if (lr?.ai === 'running') line = `<span class="spinner"></span> Rule checks done. AI checks running (${esc(aiState.model || 'Gemini')})…`;
  else if (lr) line = `Reviewed ${timeAgo(lr.at)} · ${lr.ai === 'ok' ? `rules + AI (${esc(lr.model || 'Gemini')})` : 'rules only'}`;
  else line = 'Not reviewed yet.';
  const warn = lr && d.needsReview && d.status !== 'approved' ? `<div class="notice warn" style="margin-top:8px">The content changed since the last review. Run the review again.</div>` : '';
  const aiNote = lr && lr.ai !== 'running' && lr.message ? `<div class="notice info" style="margin-top:8px">${esc(lr.message)}</div>` : '';
  const canRun = d.status !== 'approved';
  let body;
  if (!lr && !reviewing) {
    body = `<div class="empty"><p>Check this draft against ${ws.rules.filter((r) => r.active !== false).length} brand rules and ${ws.facts.filter((f) => !f.confidential).length} approved facts.</p>${canRun ? `<button class="btn primary" data-action="run-review" data-id="${d.id}">Run review</button>` : ''}</div>`;
  } else if (!list.length) {
    body = `<div class="empty">${filter === 'open' ? (lr ? '<b>No open findings.</b><br>Everything is resolved or nothing was flagged.' : '') : 'Nothing to show.'}</div>`;
  } else {
    body = list.map((f) => findingCard(d, f)).join('');
  }
  return `<aside class="card findings" aria-label="Findings">
    <div class="findings-head">
      <div class="row"><h2>Findings</h2>${lr ? countChips(countBySeverity(open)) : ''}
        ${canRun && lr ? `<button class="btn small" data-action="run-review" data-id="${d.id}" ${reviewing || lr?.ai === 'running' ? 'disabled' : ''}>Re-run</button>` : ''}</div>
      <div class="review-line">${line}</div>
      ${warn}${aiNote}
      ${lr ? `<div class="tabs" role="tablist" style="margin:10px 0 -11px">
        <button role="tab" aria-selected="${filter === 'open'}" data-action="filter-findings" data-filter="open">Open<span class="n">${open.length}</span></button>
        <button role="tab" aria-selected="${filter === 'resolved'}" data-action="filter-findings" data-filter="resolved">Resolved<span class="n">${resolved.length}</span></button>
        <button role="tab" aria-selected="${filter === 'all'}" data-action="filter-findings" data-filter="all">All<span class="n">${all.length}</span></button>
      </div>` : ''}
    </div>
    <div class="findings-list">${body}</div>
    ${howChecked(d)}
  </aside>`;
}

function sourceLabel(f) {
  const conf = f.confidence != null && f.confidence < 1 ? ` · ${Math.round(f.confidence * 100)}%` : '';
  if (f.source === 'hybrid') return `<span class="src"><span class="rule-badge">RULE</span><span class="ai-badge">+ AI</span>${conf}</span>`;
  if (f.aiAssisted || f.source === 'ai') return `<span class="src" title="Produced with ${esc(f.model || 'an AI model')}"><span class="ai-badge">AI-ASSISTED</span>${conf}</span>`;
  return `<span class="src"><span class="rule-badge">RULE-BASED</span></span>`;
}

function findingCard(d, f) {
  const r = rule(f.ruleId);
  const fc = f.factId ? fact(f.factId) : null;
  const open = f.status === 'open';
  const editable = canEdit(d);
  const reviewing = ui.reviewing[d.id] || d.lastReview?.ai === 'running';
  const exp = ui.expanded[f.id];
  const isArtwork = f.fix?.kind === 'artwork';
  const canFix = open && !f.stale && f.fix && !isArtwork && editable && !reviewing;
  const appendLabel = f.fix?.kind === 'append' ? '<span class="muted small">Added at the end: </span>' : '';
  const canDismiss = open && f.severity !== 'blocker' && (editable || (actor().role === 'manager' && d.status !== 'approved'));
  const canOverrideIt = open && f.severity === 'blocker' && canOverride(d);
  const targetLabel = f.target === 'image' ? '<span class="tag">image</span>' : '';

  let fixHtml = '';
  if (f.fix && open) {
    const original = f.target === 'image' && f.fix.kind === 'alt' ? (d.image?.alt || '') : f.quote || '';
    if (ui.editFix === f.id) {
      fixHtml = `<div class="fix"><div class="lbl">Edit the fix</div><textarea id="fix-edit-${esc(f.id)}" rows="3">${esc(f.fix.replacement)}</textarea>
        <div class="row" style="margin-top:6px"><button class="btn small primary" data-action="apply-edited-fix" data-fid="${esc(f.id)}">Apply</button><button class="btn small" data-action="cancel-edit-fix">Cancel</button></div></div>`;
    } else {
      fixHtml = `<div class="fix"><div class="lbl">${isArtwork ? 'Suggested wording for the artwork' : f.fix.kind === 'alt' ? 'Suggested alt text' : 'Suggested fix'}</div>
        <div class="diff">${appendLabel}${f.fix.kind === 'alt' || isArtwork || f.fix.kind === 'append' ? `<ins>${esc(f.fix.replacement)}</ins>` : renderDiff(original, f.fix.replacement)}</div>
        ${f.fix.note ? `<p class="note">${esc(f.fix.note)}</p>` : ''}</div>`;
    }
  }
  const rejected = f.rejectedFix && open ? `<div class="rejected"><b>AI rewrite rejected by the validator:</b> “${esc(f.rejectedFix.replacement)}”. ${esc(f.rejectedFix.reason)}</div>` : '';
  const refs = `<div class="refs">
    ${r ? `<button class="tag" data-action="toggle-ref" data-fid="${esc(f.id)}" data-kind="rule" aria-expanded="${exp === 'rule'}">${esc(r.id)}</button>` : ''}
    ${fc ? `<button class="tag" data-action="toggle-ref" data-fid="${esc(f.id)}" data-kind="fact" aria-expanded="${exp === 'fact'}">${esc(fc.id)}</button>` : ''}
    ${targetLabel}
  </div>`;
  let refDetail = '';
  if (exp === 'rule' && r) refDetail = `<div class="ref-detail"><b>${esc(r.id)} · ${esc(r.title)}</b><br>${esc(r.description)}<br><span class="muted">Severity: ${esc(SEVERITY[r.severity])} · Owner: ${esc(r.owner || '')}</span></div>`;
  if (exp === 'fact' && fc) refDetail = `<div class="ref-detail"><b>${esc(fc.id)}</b> ${esc(fc.statement)}<br><span class="muted">Source: ${esc(fc.source)} · Owner: ${esc(fc.owner)}${fc.expires ? ` · Expires ${fmtDate(fc.expires)}${fc.expires < todayISO() ? ' (expired)' : ''}` : ''}</span></div>`;

  const actions = open ? `<footer>
      ${canFix ? `<button class="btn small primary" data-action="accept-fix" data-fid="${esc(f.id)}">${f.fix.replacement === '' ? 'Accept: remove' : 'Accept fix'}</button><button class="btn small" data-action="edit-fix" data-fid="${esc(f.id)}">Edit fix</button>` : ''}
      ${!f.fix && editable && f.target === 'text' && !f.stale ? `<button class="btn small" data-action="edit-body">Edit text</button>` : ''}
      ${canDismiss ? `<button class="btn small ghost" data-action="dismiss" data-fid="${esc(f.id)}">Dismiss…</button>` : ''}
      ${canOverrideIt ? `<button class="btn small danger" data-action="override" data-fid="${esc(f.id)}">Override blocker…</button>` : ''}
      ${open && f.severity === 'blocker' && editable && actor().role !== 'manager' && !f.fix ? '<span class="muted small">Blockers can only be fixed, or overridden by a Brand Manager.</span>' : ''}
    </footer>` : `<div class="resolution">${esc(RESOLVED_LABEL[f.status] || f.status)} by ${esc(f.resolution?.by || '')} · ${timeAgo(f.resolution?.at)}${f.resolution?.reason ? `<br><b>Reason:</b> ${esc(f.resolution.reason)}` : ''}${f.resolution?.carried ? '<br><span class="muted">Kept from an earlier review.</span>' : ''}</div>`;

  return `<article class="finding f-${esc(f.severity)}${open ? '' : ' resolved'}${ui.activeFinding === f.id ? ' active' : ''}" id="card-${esc(f.id)}">
    <header>${sevChip(f.severity)}<span class="small muted">${esc(f.category)}</span>${sourceLabel(f)}</header>
    <h4>${esc(f.title)}</h4>
    ${f.quote ? `<p class="quote" data-action="focus-finding" data-fid="${esc(f.id)}" title="Show in the text">${f.target === 'image' ? '<span class="muted small">In the image: </span>' : ''}“${esc(f.quote.trim())}”</p>` : ''}
    ${f.stale ? '<div class="notice warn" style="margin-bottom:8px">This text has changed since the review. Re-run the review to update this finding.</div>' : ''}
    <p class="why">${esc(f.reason)}${f.aiNote ? ` <span class="muted">AI note: ${esc(f.aiNote)}</span>` : ''}</p>
    ${refs}${refDetail}${rejected}${fixHtml}${actions}
  </article>`;
}

function renderDiff(a, b) {
  if (b === '') return `<del>${esc(a)}</del> <span class="muted small">(removed)</span>`;
  const parts = diffWords(a, b);
  const same = parts.filter((p) => p.type === 'eq').reduce((n, p) => n + p.text.trim().length, 0);
  if (same < 0.5 * Math.max(a.length, b.length) && parts.length > 3) return `<del>${esc(a)}</del><br><ins>${esc(b)}</ins>`;
  return parts.map((p, i) => (p.type === 'eq' ? esc(p.text) : p.type === 'del' ? `<del>${esc(p.text)}</del>${parts[i + 1]?.type === 'ins' ? ' ' : ''}` : `<ins>${esc(p.text)}</ins>`)).join('');
}

function howChecked(d) {
  const lr = d.lastReview;
  const rulesActive = ws.rules.filter((r) => r.active !== false);
  const ruleBased = rulesActive.filter((r) => r.engine !== 'ai').length;
  const aiRules = rulesActive.filter((r) => r.engine !== 'rule').length;
  return `<details class="checked">
    <summary>How this was checked</summary>
    <ul>
      <li><b>${ruleBased} rule-based checks</b> run in your browser: terminology, brand name, competitors, guarantees, confidential terms, "T&C apply", hype, sentence length, palette, contrast and alt text.</li>
      <li><b>Numbers are checked by a comparator, not by the AI.</b> Each figure is matched to the fact ledger with keyword retrieval and compared with its qualifier ("over", "up to", "about"). Expired facts are reported as outdated.</li>
      <li><b>${aiRules} AI-assisted checks</b> (${esc(aiState.provider)}${lr?.model ? `, ${esc(lr.model)}` : ''}) find implied claims and judge tone and messaging. Each claim is verified against only the closest approved facts. Every AI finding is labelled.</li>
      <li><b>A validator</b> rejects any suggested rewrite that adds a number, ranking or banned term not found in the original or the cited fact.</li>
      <li><b>Privacy:</b> confidential terms and personal data (emails, phone numbers, UPI IDs) are redacted before the AI call${lr?.privacy ? ` (${lr.privacy.redacted} redacted in this review)` : ''}, and facts marked confidential are never sent.</li>
      <li><b>People decide.</b> Nothing is changed until someone accepts a fix, and blockers can only be overridden by a Brand Manager with a written reason.</li>
    </ul>
  </details>`;
}

// ---- Comments, versions, activity ---------------------------------------------------------
function subPanels(d) {
  const tab = ui.subtab;
  const tabs = [['comments', `Comments<span class="n">${d.comments.length}</span>`], ['versions', `Version history<span class="n">${d.versions.length}</span>`], ['activity', 'Activity']];
  let body = '';
  if (tab === 'comments') {
    body = `${d.comments.length ? d.comments.map((c) => `<div class="comment"><span class="who">${esc(c.by)}</span> <span class="muted small">${esc(roleName(c.role))}</span><span class="when">${timeAgo(c.at)}</span><p>${esc(c.text)}</p></div>`).join('') : '<p class="muted">No comments yet.</p>'}
      <div style="margin-top:12px"><label for="comment-input">Add a comment as ${esc(actor().name)} (${esc(roleName(actor().role))})</label><textarea id="comment-input" rows="2" placeholder="Write a comment for the team"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn small" data-action="add-comment" data-id="${d.id}">Post comment</button></div></div>`;
  } else if (tab === 'versions') {
    const versions = [...d.versions].reverse();
    const sel = d.versions.find((v) => v.n === ui.selectedVersion) || d.versions.at(-1);
    const prev = d.versions.find((v) => v.n === sel.n - 1);
    body = `<div class="versions"><ul>${versions.map((v) => `<li><button aria-pressed="${v.n === sel.n}" data-action="select-version" data-n="${v.n}"><b>v${v.n}</b> · ${esc(v.note)}<br><span class="muted">${esc(v.by)} · ${timeAgo(v.at)}</span></button></li>`).join('')}</ul>
      <div><div class="small muted" style="margin-bottom:6px">${prev ? `Changes from v${prev.n} to v${sel.n}` : `v${sel.n} (first version)`}</div><div class="diff">${prev ? diffWords(prev.body, sel.body).map((p) => (p.type === 'eq' ? esc(p.text) : p.type === 'del' ? `<del>${esc(p.text)}</del>` : `<ins>${esc(p.text)}</ins>`)).join('') : esc(sel.body)}</div></div></div>`;
  } else {
    const items = ws.audit.filter((a) => a.draftId === d.id);
    body = items.length ? `<ul class="timeline">${items.map((a) => `<li><time datetime="${esc(a.at)}">${fmtDateTime(a.at)}</time><div><b>${esc(a.actor)}</b> <span class="muted">(${esc(roleName(a.role))})</span> ${esc(a.action.toLowerCase())}${a.detail ? `<div class="muted small">${esc(a.detail)}</div>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">No activity yet.</p>';
  }
  return `<section class="card subtabs"><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-action="subtab" data-tab="${k}">${l}</button>`).join('')}</div><div class="panel-body">${body}</div></section>`;
}

export function roleName(role) {
  return { creator: 'Creator', reviewer: 'Reviewer', manager: 'Brand Manager' }[role] || role;
}
