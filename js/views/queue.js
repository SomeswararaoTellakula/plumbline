// Review queue: every draft with its status and open findings.
import { ws, prefs, openFindings, countBySeverity, actor } from '../store.js';
import { esc, statusPill, countChips, timeAgo } from '../ui.js';
import { ui } from '../state.js';

const TABS = [
  ['all', 'All'],
  ['draft', 'Drafts'],
  ['in_review', 'In review'],
  ['changes_requested', 'Changes requested'],
  ['approved', 'Approved'],
];

function startHere() {
  if (prefs().hideStart) return '';
  return `<section class="card start" aria-label="How to try Plumbline">
    <div class="lead">
      <h2>Try the full review in two minutes</h2>
      <p>This is a demo workspace for <b>NimbuPay</b>, a fictional UPI payments brand. Its Brand Kit (rules, terms, approved facts, palette) is already set up.</p>
      <button class="btn brass small" data-action="open-draft" data-id="D-101">Open the Diwali post</button>
    </div>
    <div>
      <button class="btn ghost small close" data-action="hide-start" aria-label="Hide this guide">Hide</button>
      <ol>
        <li>Open <b>Diwali cashback: Instagram post</b> and press <b>Run review</b>. Rule checks appear instantly; AI checks follow.</li>
        <li>Read why each issue was flagged. <b>Accept</b>, <b>edit</b> or <b>dismiss</b> each fix (dismissing needs a reason).</li>
        <li>When no blockers are left, <b>Submit for review</b>.</li>
        <li>Switch <b>Acting as</b> (top right) to Arjun (Reviewer) or Meera (Brand Manager), then <b>approve</b> or <b>request changes</b>.</li>
      </ol>
    </div>
  </section>`;
}

export function renderQueue() {
  const tab = ui.queueTab || 'all';
  const counts = Object.fromEntries(TABS.map(([k]) => [k, k === 'all' ? ws.drafts.length : ws.drafts.filter((d) => d.status === k).length]));
  const list = ws.drafts
    .filter((d) => tab === 'all' || d.status === tab)
    .sort((a, b) => order(a) - order(b) || new Date(b.updatedAt) - new Date(a.updatedAt));
  const canCreate = actor().role !== 'reviewer';
  return `
  ${startHere()}
  <div class="page-head">
    <div>
      <h1>Review queue</h1>
      <p>Content waiting to be checked against the ${esc(ws.brand.name)} Brand Kit before it is published.</p>
    </div>
    <div class="row">
      ${canCreate ? '<button class="btn primary" data-action="new-draft">+ New draft</button>' : '<span class="muted small">Reviewers review; switch to Priya or Meera to create drafts.</span>'}
    </div>
  </div>
  <div class="tabs" role="tablist">
    ${TABS.map(([k, label]) => `<button role="tab" aria-selected="${tab === k}" data-action="queue-tab" data-tab="${k}">${label}<span class="n">${counts[k]}</span></button>`).join('')}
  </div>
  <div class="card">
    ${list.length ? `<table class="queue">
      <thead><tr><th>Content</th><th class="hide-sm">Channel</th><th>Status</th><th>Open findings</th><th class="hide-sm">Updated</th></tr></thead>
      <tbody>${list.map(row).join('')}</tbody>
    </table>` : '<div class="empty">Nothing here yet.</div>'}
  </div>`;
}

function order(d) {
  const mine = { creator: ['changes_requested', 'draft'], reviewer: ['in_review'], manager: ['in_review', 'changes_requested'] }[actor().role] || [];
  return mine.includes(d.status) ? 0 : d.status === 'approved' ? 2 : 1;
}

function row(d) {
  const open = openFindings(d);
  const findings = d.lastReview ? countChips(countBySeverity(open)) : '<span class="muted small">Not reviewed yet</span>';
  return `<tr data-action="open-draft" data-id="${esc(d.id)}">
    <td class="title"><a href="#/draft/${esc(d.id)}">${esc(d.title)}</a><div class="muted small">${esc(d.id)} · by ${esc(d.author)}${d.image ? ' · with image' : ''}</div></td>
    <td class="hide-sm">${esc(d.channel)}</td>
    <td>${statusPill(d.status)}</td>
    <td>${findings}</td>
    <td class="hide-sm muted small">${timeAgo(d.updatedAt)}</td>
  </tr>`;
}
