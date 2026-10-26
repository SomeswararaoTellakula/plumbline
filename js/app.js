// App shell: routing, top bar, and every user action.
import * as store from './store.js';
import { ws } from './store.js';
import { ACTORS } from './seed.js';
import { ui } from './state.js';
import { esc, toast, openModal, ICON } from './ui.js';
import { renderQueue } from './views/queue.js';
import { renderDraft } from './views/draft.js';
import { renderKit } from './views/kit.js';
import { renderActivity } from './views/activity.js';
import { runReview } from './review.js';
import { aiState, checkHealth, aiImportKit } from './ai.js';
import { toDataUrl, readFileAsDataUrl, readFileAsText } from './image.js';
import { parseQuantities } from './lib/text.js';

const main = document.getElementById('main');

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = h.split('/');
  if (page === 'draft' && arg) return { page: 'draft', id: decodeURIComponent(arg) };
  if (page === 'kit') return { page: 'kit', tab: arg };
  if (page === 'activity') return { page: 'activity' };
  return { page: 'queue' };
}

function renderTopbar(r) {
  const a = store.actor();
  const status = !aiState.checked ? '<span class="dot"></span> Checking AI…' : aiState.available ? `<span class="dot on"></span> AI checks on` : '<span class="dot off"></span> Rule checks only';
  document.getElementById('topbar').innerHTML = `
    <a class="brandmark" href="#/">${ICON.plumb}<span><b>Plumbline</b><small>Brand review before you publish</small></span></a>
    <nav class="nav" aria-label="Main">
      <a href="#/" ${r.page === 'queue' || r.page === 'draft' ? 'aria-current="page"' : ''}>Review queue</a>
      <a href="#/kit" ${r.page === 'kit' ? 'aria-current="page"' : ''}>Brand Kit</a>
      <a href="#/activity" ${r.page === 'activity' ? 'aria-current="page"' : ''}>Activity</a>
    </nav>
    <span class="spacer"></span>
    <span class="ai-status" title="${aiState.available ? `${esc(aiState.provider)} · ${esc(aiState.model)}` : 'Rule-based checks always run. AI-assisted checks need a configured API key.'}">${status}</span>
    <div class="acting"><span>Acting as</span><div class="roles" role="group" aria-label="Acting as">
      ${Object.values(ACTORS).map((x) => `<button aria-pressed="${a.role === x.role}" data-action="role" data-role="${x.role}">${esc(x.name)} · ${esc(x.label)}</button>`).join('')}
    </div></div>`;
  document.getElementById('demo-bar').innerHTML = `<div class="inner"><span><b>Demo workspace</b> for the fictional brand NimbuPay. No sign-in: your changes are saved in this browser only.</span><button data-action="reset-demo">Reset demo</button></div>`;
}

export function render() {
  const r = route();
  const y = window.scrollY;
  const list = document.querySelector('.findings-list');
  const listY = list ? list.scrollTop : 0;
  const samePage = render.last === location.hash;
  renderTopbar(r);
  if (r.page === 'draft') main.innerHTML = renderDraft(r.id);
  else if (r.page === 'kit') { if (r.tab) ui.kitTab = r.tab; main.innerHTML = renderKit(); }
  else if (r.page === 'activity') main.innerHTML = renderActivity();
  else main.innerHTML = renderQueue();
  if (samePage) {
    window.scrollTo(0, y);
    const l2 = document.querySelector('.findings-list');
    if (l2) l2.scrollTop = listY;
  } else {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  render.last = location.hash;
}

function currentDraft() {
  const r = route();
  return r.page === 'draft' ? store.getDraft(r.id) : null;
}

function findFinding(d, fid) {
  return d?.findings.find((f) => f.id === fid);
}

async function doReview(d) {
  if (ui.reviewing[d.id]) return;
  ui.reviewing[d.id] = 'rules';
  ui.findingsFilter = 'open';
  render();
  try {
    await runReview(d, () => { ui.reviewing[d.id] = d.lastReview?.ai === 'running' ? 'ai' : null; render(); });
    const c = d.lastReview?.counts || {};
    const n = (c.blocker || 0) + (c.high || 0) + (c.medium || 0) + (c.low || 0);
    toast(n ? `Review done: ${n} open finding${n > 1 ? 's' : ''}${c.blocker ? `, ${c.blocker} blocker${c.blocker > 1 ? 's' : ''}` : ''}.` : 'Review done: nothing flagged.');
  } catch (e) {
    toast(`Review failed: ${e.message}`, 'bad');
  } finally {
    ui.reviewing[d.id] = null;
    render();
  }
}

function focusFinding(fid) {
  ui.activeFinding = fid;
  render();
  requestAnimationFrame(() => {
    document.getElementById(`card-${fid}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.querySelector(`mark[data-fid="${CSS.escape(fid)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

const DISMISS_REASONS = ['Not a real problem here (false positive)', 'Approved exception for this content', 'Will be fixed outside Plumbline (e.g. in the artwork)', 'The rule is unclear or does not fit this case'];

const actions = {
  role: (el) => { store.setRole(el.dataset.role); ui.editing = false; ui.editFix = null; toast(`Now acting as ${store.actor().name} (${store.actor().label}).`); },
  'reset-demo': () => openModal({
    title: 'Reset the demo workspace?', submitLabel: 'Reset', submitClass: 'danger',
    body: '<p>This restores the NimbuPay Brand Kit and the sample drafts, and clears your changes in this browser.</p>',
    onSubmit: () => { store.resetWorkspace(); Object.assign(ui, { editing: false, editFix: null, activeFinding: null, pendingImport: null, reviewing: {} }); location.hash = '#/'; toast('Demo reset.'); },
  }),
  'hide-start': () => { store.setPref('hideStart', true); render(); },
  'queue-tab': (el) => { ui.queueTab = el.dataset.tab; render(); },
  'open-draft': (el) => { ui.editing = false; ui.editFix = null; ui.activeFinding = null; ui.subtab = 'comments'; ui.selectedVersion = null; location.hash = `#/draft/${el.dataset.id}`; },
  'new-draft': () => newDraftModal(),
  'run-review': (el) => { const d = store.getDraft(el.dataset.id); if (d) doReview(d); },
  submit: (el) => {
    const d = store.getDraft(el.dataset.id);
    const why = store.submitBlockers(d);
    if (why) return toast(why, 'bad');
    store.submit(d);
    toast('Submitted for review. Switch "Acting as" to Arjun or Meera to decide.');
  },
  approve: (el) => {
    const d = store.getDraft(el.dataset.id);
    const blocked = store.approveBlockers(d);
    if (blocked) return toast(blocked, 'bad');
    const open = store.openFindings(d);
    const refs = [...new Set((d.supported || []).map((s) => s.factId).filter(Boolean))];
    openModal({
      title: 'Approve for publishing', submitLabel: 'Approve', submitClass: 'good',
      body: `<p>${open.length ? `<b>${open.length} non-blocking finding${open.length > 1 ? 's are' : ' is'} still open.</b> Approving accepts ${open.length > 1 ? 'them' : 'it'} as they are.` : 'All findings are resolved.'}</p>
        ${refs.length ? `<p class="small">This version relies on approved facts <b>${refs.map(esc).join(', ')}</b>. They will be recorded with the approval.</p>` : ''}
        <div class="field"><label for="approve-note">Note (optional)</label><textarea id="approve-note" name="note" rows="2"></textarea></div>`,
      onSubmit: (fd) => { store.approve(d, String(fd.get('note') || '').trim()); toast(`Approved by ${store.actor().name}.`); },
    });
  },
  'request-changes': (el) => {
    const d = store.getDraft(el.dataset.id);
    openModal({
      title: 'Request changes', submitLabel: 'Send back to creator', submitClass: 'danger',
      body: '<div class="field"><label for="rc-note">What needs to change?</label><textarea id="rc-note" name="note" rows="3" required></textarea><div class="hint">The creator sees this note at the top of the draft.</div></div>',
      onSubmit: (fd) => {
        const note = String(fd.get('note') || '').trim();
        if (note.length < 5) return 'Please explain what needs to change.';
        store.requestChanges(d, note);
        toast('Sent back to the creator.');
      },
    });
  },
  reopen: (el) => { store.reopen(store.getDraft(el.dataset.id)); toast('Reopened for edits.'); },
  'edit-body': () => { ui.editing = true; render(); document.getElementById('body-editor')?.focus(); },
  'cancel-edit': () => { ui.editing = false; render(); },
  'save-body': (el) => {
    const d = store.getDraft(el.dataset.id);
    const text = document.getElementById('body-editor').value.trim();
    if (text.length < 5) return toast('The text is too short.', 'bad');
    if (text.length > 6000) return toast('Keep drafts under 6,000 characters.', 'bad');
    store.editBody(d, text);
    ui.editing = false;
    render();
    toast('Saved as a new version. Run the review again.');
  },
  'remove-image': (el) => { store.setImage(store.getDraft(el.dataset.id), null); },
  'save-alt': (el) => { store.setAlt(store.getDraft(el.dataset.id), document.getElementById('alt-input').value.trim()); toast('Alt text saved.'); },
  'focus-finding': (el) => focusFinding(el.dataset.fid),
  'filter-findings': (el) => { ui.findingsFilter = el.dataset.filter; render(); },
  'toggle-ref': (el) => { const k = el.dataset.kind; ui.expanded[el.dataset.fid] = ui.expanded[el.dataset.fid] === k ? null : k; render(); },
  'accept-fix': (el) => {
    const d = currentDraft();
    const f = findFinding(d, el.dataset.fid);
    if (!f?.fix) return;
    if (!store.applyFix(d, f, f.fix.replacement)) return toast('The quoted text has changed. Run the review again.', 'bad');
    toast('Fix applied and saved as a new version.');
  },
  'edit-fix': (el) => { ui.editFix = el.dataset.fid; render(); document.getElementById(`fix-edit-${el.dataset.fid}`)?.focus(); },
  'cancel-edit-fix': () => { ui.editFix = null; render(); },
  'apply-edited-fix': (el) => {
    const d = currentDraft();
    const f = findFinding(d, el.dataset.fid);
    const value = document.getElementById(`fix-edit-${f.id}`).value;
    ui.editFix = null;
    if (!store.applyFix(d, f, value.trim(), true)) return toast('The quoted text has changed. Run the review again.', 'bad');
    toast('Your edited fix was applied.');
  },
  dismiss: (el) => reasonModal(el.dataset.fid, 'dismissed'),
  override: (el) => reasonModal(el.dataset.fid, 'overridden'),
  subtab: (el) => { ui.subtab = el.dataset.tab; render(); },
  'select-version': (el) => { ui.selectedVersion = Number(el.dataset.n); render(); },
  'add-comment': (el) => {
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if (!text) return toast('Write a comment first.', 'bad');
    store.addComment(store.getDraft(el.dataset.id), text);
  },
  'goto-fact': (el) => { ui.highlightFact = el.dataset.fact; location.hash = '#/kit/facts'; setTimeout(() => document.getElementById(`fact-${el.dataset.fact}`)?.scrollIntoView({ block: 'center' }), 50); },
  'kit-tab': (el) => { ui.kitTab = el.dataset.tab; location.hash = `#/kit/${el.dataset.tab}`; },
  'toggle-rule': (el) => { const r = store.rule(el.dataset.rid); r.active = r.active === false; store.log(r.active ? 'Activated rule' : 'Deactivated rule', null, r.id); store.save(); },
  'edit-rule': (el) => ruleModal(store.rule(el.dataset.rid)),
  'add-rule': () => ruleModal(null),
  'add-term': () => termModal(),
  'delete-term': (el) => { const t = ws.terms.find((x) => x.id === el.dataset.tid); ws.terms = ws.terms.filter((x) => x !== t); store.log('Deleted term', null, t.term); store.save(); },
  'edit-fact': (el) => factModal(store.fact(el.dataset.fact)),
  'add-fact': () => factModal(null),
  'add-colour': () => colourModal(),
  'edit-tone': () => toneModal(),
  'sample-import': () => { ui.importText = "Brand voice: warm, plain and helpful. Always write our name as NimbuPay. Never describe NimbuPay as a 'super app' or 'the only app you need'. Spell out numbers one to nine in body copy. Any mention of interest, loans or credit must be approved by Legal before publishing. NimbuPay won the 2026 Fintech Design Award (source: award letter, March 2026)."; render(); },
  'run-import': async () => {
    const text = document.getElementById('import-text').value;
    ui.importText = text;
    if (text.trim().length < 40) return toast('Paste at least a few sentences.', 'bad');
    ui.importing = true; render();
    try {
      const res = await aiImportKit(text, ws.tone.confidentialTerms);
      ui.pendingImport = { rules: res.rules || [], terms: res.terms || [], facts: res.facts || [] };
      if (!ui.pendingImport.rules.length && !ui.pendingImport.terms.length && !ui.pendingImport.facts.length) toast('Nothing checkable was found in that text.');
    } catch (e) { toast(e.message, 'bad'); }
    ui.importing = false; render();
  },
  'discard-import': () => { ui.pendingImport = null; render(); },
  'confirm-import': () => {
    const form = document.getElementById('import-form');
    const p = ui.pendingImport;
    let added = 0;
    p.rules.forEach((r, i) => { if (form[`rule-${i}`]?.checked) { ws.rules.push({ id: store.uid('R'), category: r.category, title: r.title, description: r.description, severity: r.severity, engine: 'ai', example: '', active: true, owner: `${store.actor().name} (imported)` }); added++; } });
    p.terms.forEach((t, i) => { if (form[`term-${i}`]?.checked) { ws.terms.push({ id: store.uid('T'), term: t.term, kind: t.kind, replacement: t.replacement || '', ruleId: t.kind === 'competitor' ? 'TON-03' : t.kind === 'banned' ? 'TRM-02' : 'TRM-03' }); added++; } });
    p.facts.forEach((f, i) => { if (form[`fact-${i}`]?.checked) { const q = parseQuantities(f.statement)[0]; ws.facts.push({ id: store.uid('F'), statement: f.statement, metric: '', keywords: [], quantity: q ? { value: q.value, unitType: q.unitType, qualifier: q.qualifier } : null, display: q ? q.raw : '', source: f.source, owner: store.actor().name, updated: new Date().toISOString().slice(0, 10), expires: '', confidential: false }); added++; } });
    store.log('Imported from brand guide', null, `${added} item${added === 1 ? '' : 's'} confirmed`);
    ui.pendingImport = null;
    store.save();
    toast(`Added ${added} item${added === 1 ? '' : 's'} to the Brand Kit.`);
  },
};

// ---- Modals -------------------------------------------------------------------------------
function reasonModal(fid, kind) {
  const d = currentDraft();
  const f = findFinding(d, fid);
  if (!f) return;
  const override = kind === 'overridden';
  openModal({
    title: override ? 'Override a blocker' : 'Dismiss this finding',
    submitLabel: override ? 'Override with reason' : 'Dismiss', submitClass: override ? 'danger' : 'primary',
    body: `<p class="small"><b>${esc(f.ruleId)} · ${esc(f.title)}</b>${f.quote ? `<br>“${esc(f.quote)}”` : ''}</p>
      ${override ? '<p class="notice warn">Overrides are recorded in the audit log with your name and reason, and the reviewer will see them.</p>' : ''}
      <div class="field"><label for="reason-kind">Reason</label><select id="reason-kind" name="kind">${DISMISS_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>
      <div class="field"><label for="reason-note">Explain (required)</label><textarea id="reason-note" name="note" rows="2" placeholder="e.g. Legal approved this wording on 20 Oct"></textarea></div>`,
    onSubmit: (fd) => {
      const note = String(fd.get('note') || '').trim();
      if (note.length < 5) return 'Please add a short explanation; it is kept in the audit log.';
      store.dismissFinding(d, f, `${fd.get('kind')}: ${note}`, kind);
      toast(override ? 'Blocker overridden and logged.' : 'Finding dismissed and logged.');
    },
  });
}

function newDraftModal() {
  const channels = ['Instagram', 'LinkedIn', 'X / Twitter', 'Email', 'Blog', 'Website banner', 'Push notification', 'Brochure', 'Press release'];
  openModal({
    title: 'New draft', submitLabel: 'Create draft', wide: true,
    body: `<div class="grid2"><div class="field"><label for="nd-title">Title</label><input id="nd-title" name="title" type="text" maxlength="90" placeholder="e.g. Holi offer: Instagram story" required></div>
      <div class="field"><label for="nd-channel">Channel</label><select id="nd-channel" name="channel">${channels.map((c) => `<option>${c}</option>`).join('')}</select></div></div>
      <div class="field"><label for="nd-body">Text</label><textarea id="nd-body" name="body" rows="8" placeholder="Paste or write the content to check"></textarea><div class="hint">Or load a .txt or .md file: <input type="file" accept=".txt,.md,text/plain" id="nd-file"></div></div>
      <div class="grid2"><div class="field"><label for="nd-image">Image (optional)</label><input id="nd-image" name="image" type="file" accept="image/png,image/jpeg,image/webp"></div>
      <div class="field"><label for="nd-alt">Alt text (optional)</label><input id="nd-alt" name="alt" type="text" maxlength="300"></div></div>`,
    onSubmit: async (fd) => {
      const title = String(fd.get('title') || '').trim();
      const body = String(fd.get('body') || '').trim();
      if (!title) return 'Give the draft a title.';
      if (body.length < 10) return 'Add the text to check (at least a sentence).';
      if (body.length > 6000) return 'Keep drafts under 6,000 characters.';
      const file = fd.get('image');
      let image = null;
      if (file && file.size) {
        if (file.size > 8_000_000) return 'Images must be under 8 MB.';
        const src = await toDataUrl(await readFileAsDataUrl(file), 1200);
        image = { src, name: file.name, alt: String(fd.get('alt') || '').trim() };
      }
      const d = store.createDraft({ title, channel: String(fd.get('channel')), body, image });
      location.hash = `#/draft/${d.id}`;
      toast('Draft created. Press "Run review" to check it.');
    },
  });
  document.getElementById('nd-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) document.getElementById('nd-body').value = (await readFileAsText(f)).slice(0, 6000);
  });
}

function ruleModal(r) {
  const cats = ['Terminology', 'Claims', 'Tone', 'Messaging', 'Legal', 'Accessibility', 'Visual', 'Confidentiality'];
  openModal({
    title: r ? `Edit ${r.id}` : 'Add a rule',
    body: `<div class="field"><label for="r-title">Rule</label><input id="r-title" name="title" type="text" value="${esc(r?.title || '')}" placeholder="e.g. Never promise instant refunds"></div>
      <div class="field"><label for="r-desc">What it means</label><textarea id="r-desc" name="description" rows="3">${esc(r?.description || '')}</textarea><div class="hint">${r ? '' : 'New rules are judged by the AI, so describe what counts as a breach.'}</div></div>
      <div class="grid2"><div class="field"><label for="r-cat">Category</label><select id="r-cat" name="category" ${r ? 'disabled' : ''}>${cats.map((c) => `<option ${r?.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="r-sev">Severity</label><select id="r-sev" name="severity">${['blocker', 'high', 'medium', 'low'].map((s) => `<option value="${s}" ${(r?.severity || 'medium') === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div></div>`,
    onSubmit: (fd) => {
      const title = String(fd.get('title') || '').trim();
      const description = String(fd.get('description') || '').trim();
      if (title.length < 4 || description.length < 8) return 'Give the rule a title and a short description.';
      if (r) { Object.assign(r, { title, description, severity: fd.get('severity') }); store.log('Edited rule', null, r.id); }
      else { const nr = { id: store.uid('R'), category: fd.get('category'), title, description, severity: fd.get('severity'), engine: 'ai', example: '', active: true, owner: `${store.actor().name} (Brand)` }; ws.rules.push(nr); store.log('Added rule', null, `${nr.id}: ${title}`); }
      store.save();
    },
  });
}

function termModal() {
  openModal({
    title: 'Add a term',
    body: `<div class="grid2"><div class="field"><label for="t-term">Word or phrase</label><input id="t-term" name="term" type="text"></div>
      <div class="field"><label for="t-kind">Type</label><select id="t-kind" name="kind"><option value="banned">Banned</option><option value="replace">Preferred term (replace)</option><option value="competitor">Competitor name</option></select></div></div>
      <div class="field"><label for="t-rep">Use instead (optional)</label><input id="t-rep" name="replacement" type="text"></div>`,
    onSubmit: (fd) => {
      const term = String(fd.get('term') || '').trim();
      const kind = String(fd.get('kind'));
      const replacement = String(fd.get('replacement') || '').trim();
      if (term.length < 2) return 'Enter the word or phrase.';
      if (kind === 'replace' && !replacement) return 'A preferred term needs a replacement.';
      ws.terms.push({ id: store.uid('T'), term, kind, replacement, ruleId: kind === 'competitor' ? 'TON-03' : kind === 'banned' ? 'TRM-02' : 'TRM-03' });
      store.log('Added term', null, term);
      store.save();
    },
  });
}

function factModal(f) {
  const q = f?.quantity;
  openModal({
    title: f ? `Edit ${f.id}` : 'Add an approved fact', wide: true,
    body: `<div class="field"><label for="f-st">Approved statement</label><textarea id="f-st" name="statement" rows="2">${esc(f?.statement || '')}</textarea></div>
      <div class="field"><label for="f-kw">Keywords that identify claims about this fact</label><input id="f-kw" name="keywords" type="text" value="${esc((f?.keywords || []).join(', '))}" placeholder="users, customers, registered"><div class="hint">Comma-separated. Used to match claims in drafts to this fact.</div></div>
      <div class="grid2"><div class="field"><label for="f-val">Checked number (optional)</label><input id="f-val" name="value" type="number" step="any" value="${q ? esc(q.value) : ''}"></div>
      <div class="field"><label for="f-unit">Unit</label><select id="f-unit" name="unitType">${['count', 'currency', 'percent', 'seconds', 'rating', 'multiple'].map((u) => `<option ${q?.unitType === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="field"><label for="f-qual">The number is</label><select id="f-qual" name="qualifier">${[['exact', 'exact'], ['atLeast', 'a minimum (over)'], ['upTo', 'a maximum (up to)'], ['approx', 'approximate']].map(([v, l]) => `<option value="${v}" ${q?.qualifier === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="f-exp">Expires (optional)</label><input id="f-exp" name="expires" type="date" value="${esc(f?.expires || '')}"></div>
      <div class="field"><label for="f-src">Source</label><input id="f-src" name="source" type="text" value="${esc(f?.source || '')}"></div>
      <div class="field"><label for="f-own">Owner</label><input id="f-own" name="owner" type="text" value="${esc(f?.owner || '')}"></div></div>
      <label class="row small" style="font-weight:400;margin-top:10px"><input type="checkbox" name="confidential" ${f?.confidential ? 'checked' : ''}> Confidential: never sent to the AI and never allowed in content</label>`,
    onSubmit: (fd) => {
      const statement = String(fd.get('statement') || '').trim();
      if (statement.length < 8) return 'Write the approved statement.';
      const raw = String(fd.get('value') || '').trim();
      const value = raw === '' ? null : Number(raw);
      const unitType = String(fd.get('unitType'));
      const quantity = value == null || Number.isNaN(value) ? null : { value, unitType, qualifier: String(fd.get('qualifier')) };
      const display = quantity ? (parseQuantities(statement).find((x) => Math.abs(x.value - value) < 1e-9)?.raw || String(value)) : '';
      const data = { statement, keywords: String(fd.get('keywords') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean), quantity, display, expires: String(fd.get('expires') || ''), source: String(fd.get('source') || '').trim() || 'Brand Kit', owner: String(fd.get('owner') || '').trim() || store.actor().name, confidential: fd.get('confidential') === 'on', updated: new Date().toISOString().slice(0, 10) };
      if (f) { Object.assign(f, data); store.log('Edited fact', null, `${f.id}: ${statement.slice(0, 80)}`); }
      else { const nf = { id: store.uid('F'), metric: '', ...data }; ws.facts.push(nf); store.log('Added fact', null, `${nf.id}: ${statement.slice(0, 80)}`); }
      store.save();
    },
  });
}

function colourModal() {
  openModal({
    title: 'Add a palette colour',
    body: '<div class="grid2"><div class="field"><label for="c-name">Name</label><input id="c-name" name="name" type="text"></div><div class="field"><label for="c-hex">Hex</label><input id="c-hex" name="hex" type="text" placeholder="#1F4D2B"></div></div>',
    onSubmit: (fd) => {
      const name = String(fd.get('name') || '').trim();
      let hex = String(fd.get('hex') || '').trim();
      if (!/^#?[0-9a-f]{6}$/i.test(hex)) return 'Use a 6-digit hex colour such as #1F4D2B.';
      hex = '#' + hex.replace('#', '').toUpperCase();
      ws.palette.push({ name: name || hex, hex });
      store.log('Added palette colour', null, `${name} ${hex}`);
      store.save();
    },
  });
}

function toneModal() {
  const t = ws.tone;
  const lines = (a) => esc((a || []).join('\n'));
  openModal({
    title: 'Edit tone of voice', wide: true,
    body: `<div class="field"><label for="tn-voice">Voice</label><textarea id="tn-voice" name="voice" rows="2">${esc(t.voice)}</textarea></div>
      <div class="grid2"><div class="field"><label for="tn-do">Do (one per line)</label><textarea id="tn-do" name="do" rows="4">${lines(t.do)}</textarea></div>
      <div class="field"><label for="tn-dont">Don't (one per line)</label><textarea id="tn-dont" name="dont" rows="4">${lines(t.dont)}</textarea></div></div>
      <div class="field"><label for="tn-km">Key messages (one per line, "Label: message")</label><textarea id="tn-km" name="keyMessages" rows="3">${lines(t.keyMessages)}</textarea></div>
      <div class="field"><label for="tn-conf">Confidential terms (one per line)</label><textarea id="tn-conf" name="confidentialTerms" rows="2">${lines(t.confidentialTerms)}</textarea></div>`,
    onSubmit: (fd) => {
      const split = (k) => String(fd.get(k) || '').split('\n').map((s) => s.trim()).filter(Boolean);
      Object.assign(ws.tone, { voice: String(fd.get('voice') || '').trim(), do: split('do'), dont: split('dont'), keyMessages: split('keyMessages'), confidentialTerms: split('confidentialTerms') });
      store.log('Edited tone of voice', null, '');
      store.save();
    },
  });
}

// ---- Wiring -------------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === 'A' || el.tagName === 'TR' || el.tagName === 'BUTTON') e.preventDefault();
  fn(el, e);
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset?.action !== 'add-image') return;
  const file = el.files?.[0];
  if (!file) return;
  if (file.size > 8_000_000) return toast('Images must be under 8 MB.', 'bad');
  try {
    const src = await toDataUrl(await readFileAsDataUrl(file), 1200);
    store.setImage(store.getDraft(el.dataset.id), { src, name: file.name, alt: '' });
    toast('Image added. Run the review to check it.');
  } catch (err) {
    toast(err.message, 'bad');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('tr[data-action]')) actions['open-draft'](e.target);
});

store.onChange((kind) => {
  if (kind === 'storage-full') toast('This browser could not save the workspace (storage is full). Try removing an image.', 'bad');
  else render();
});
window.addEventListener('hashchange', render);
render();
checkHealth().then(render);
