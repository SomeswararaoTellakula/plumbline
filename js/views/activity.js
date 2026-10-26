// Audit log: who changed, approved, dismissed or overrode what, and when.
import { ws } from '../store.js';
import { esc, fmtDateTime } from '../ui.js';
import { roleName } from './draft.js';

export function renderActivity() {
  return `<div class="page-head"><div><h1>Activity</h1><p>Every review, decision, override and Brand Kit change, newest first. Kept in this browser for the demo.</p></div></div>
  <div class="card"><table class="kit-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Detail</th></tr></thead><tbody>
  ${ws.audit.map((a) => `<tr><td class="small muted" style="white-space:nowrap">${fmtDateTime(a.at)}</td><td><b>${esc(a.actor)}</b><div class="muted small">${esc(roleName(a.role))}</div></td><td>${esc(a.action)}</td><td>${a.draftId ? (ws.drafts.some((d) => d.id === a.draftId) ? `<a href="#/draft/${esc(a.draftId)}">${esc(a.draftId)}</a>` : esc(a.draftId)) : '<span class="muted">Brand Kit</span>'}</td><td class="small">${esc(a.detail)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No activity yet.</td></tr>'}
  </tbody></table></div>`;
}
