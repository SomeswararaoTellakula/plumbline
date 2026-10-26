// Rendering helpers shared by the views.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const STATUS = {
  draft: 'Draft',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
};

export const SEVERITY = { blocker: 'Blocker', high: 'High', medium: 'Medium', low: 'Low' };

export function statusPill(status) {
  return `<span class="pill status-${esc(status)}">${esc(STATUS[status] || status)}</span>`;
}

export function sevChip(sev) {
  return `<span class="sev sev-${esc(sev)}">${esc(SEVERITY[sev] || sev)}</span>`;
}

export function countChips(c) {
  const parts = ['blocker', 'high', 'medium', 'low'].filter((k) => c[k]).map((k) => `<span class="count sev-${k}" title="${c[k]} ${SEVERITY[k].toLowerCase()}">${c[k]}</span>`);
  return parts.length ? `<span class="counts">${parts.join('')}</span>` : '<span class="muted small">None open</span>';
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function toast(message, kind = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3600);
}

const modal = () => document.getElementById('modal');

/**
 * Open a modal with a form. `onSubmit(formData, form)` may return a string to show as an error,
 * or a promise; returning nothing closes the modal.
 */
export function openModal({ title, body, submitLabel = 'Save', submitClass = 'primary', onSubmit, wide = false }) {
  const dlg = modal();
  dlg.style.width = wide ? 'min(820px, calc(100vw - 32px))' : '';
  dlg.innerHTML = `<form method="dialog" novalidate>
    <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2></div>
    <div class="modal-body">${body}<p class="notice bad" data-modal-error hidden></p></div>
    <div class="modal-foot"><button type="button" class="btn" data-modal-cancel>Cancel</button><button type="submit" class="btn ${submitClass}" data-modal-submit>${esc(submitLabel)}</button></div>
  </form>`;
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('[data-modal-error]');
  dlg.querySelector('[data-modal-cancel]').onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = dlg.querySelector('[data-modal-submit]');
    btn.disabled = true;
    try {
      const result = await onSubmit(new FormData(form), form);
      if (typeof result === 'string' && result) { err.textContent = result; err.hidden = false; return; }
      dlg.close();
    } catch (ex) {
      err.textContent = ex.message || 'Something went wrong.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };
  dlg.showModal();
  const first = dlg.querySelector('input, textarea, select');
  if (first) first.focus();
  return dlg;
}

export function closeModal() { modal().close(); }

export const ICON = {
  plumb: `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#F1EFE8"/><path d="M16 5v13" stroke="#16181D" stroke-width="2.4" stroke-linecap="round"/><path d="M16 18l-5.5 6.5h11z" fill="#B8891A"/></svg>`,
  check: '✓',
};
