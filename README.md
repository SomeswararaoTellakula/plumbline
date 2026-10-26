# Plumbline

**Brand review before you publish.** Plumbline checks a draft (text and images) against an organisation's approved brand rules, terminology, fact ledger and assets. It explains every issue with the rule or fact behind it and suggests a minimal fix. A person always makes the final decision.

Built for **Codex 48 (We Code Coders) · Inkloom AI problem statement · Round 2: The Build** by Tellakula Someswararao (solo).

- **Live demo:** https://plumbline-plum.vercel.app
- **No sign-in.** Every visitor gets their own copy of a demo workspace for **NimbuPay**, a fictional UPI payments brand.

---

## Try it in two minutes

1. Open the live link. The **Review queue** shows five drafts.
2. Open **Diwali cashback: Instagram post** and press **Run review**. Rule checks appear instantly, and AI-assisted checks are merged in a few seconds later.
3. Click a highlighted phrase or a finding to see why it was flagged, with its rule ID (for example `CLM-01`) and approved fact (for example `F-001`).
4. **Accept**, **edit** or **dismiss** each fix. Dismissing needs a reason. A blocker can only be fixed, or overridden by a Brand Manager.
5. **Submit for review**. Switch **Acting as** (top right) to *Arjun · Reviewer* or *Meera · Brand Manager*, then **Approve** or **Request changes**.
6. Look at **Version history**, the **Activity** log and the **Brand Kit**. In the Brand Kit, *Meera* can edit rules, terms, facts, palette and tone, and import rules from pasted brand-guide text.

Other drafts to try:

- **D-102** contains a claim backed by an *expired* fact.
- **D-103** contains fear-based tone and a confidential project name.
- **D-104** is in *changes requested*.
- **D-105** is already approved.

## What it checks

| Area | How | Rule IDs |
| --- | --- | --- |
| Brand name, banned words, preferred terms, competitor names | Deterministic matching against the terminology list | TRM-01/02/03, TON-03 |
| Numbers and statistics | Each figure is matched to the **fact ledger** (BM25 retrieval), then compared by a **deterministic comparator** that understands "over", "up to", "about" and "under", Indian number formats (2,50,000; lakh; crore) and units (₹, %, seconds, ratings) | CLM-01 |
| Rankings and superlatives ("fastest", "No. 1") | Need a fact that proves them; otherwise unsupported | CLM-02 |
| Guarantees ("guaranteed", "100% secure") | Deterministic | CLM-03 |
| Expired facts | Claims matching a fact past its expiry date are **outdated** until the fact owner re-confirms | CLM-04 |
| Offers without "T&C apply" | Deterministic | LEG-01 |
| Confidential project names | Deterministic blocker; also redacted before any AI call | CNF-01 |
| Hype, long sentences | Deterministic (exclamation marks, ALL CAPS, sentences over 30 words) | TON-01, TON-04 |
| Tone, pressure, fear, key messages, implied claims | **AI-assisted** (Gemini), constrained to the listed rules | TON-02, MSG-01, custom rules |
| Image alt text | Missing alt text is flagged; the AI drafts a description | ACC-01 |
| Image contrast | Text and background colours (read by the AI, or estimated from dominant colours) → WCAG 2.x ratio computed in code | ACC-02 |
| Image palette | k-means dominant colours in the browser → CIEDE2000 distance to the brand palette | VIS-01 |
| Claims inside images | The AI transcribes the text in the image, and the same claim checks run on it | CLM-* |

### How AI is kept honest

- **Rules first, AI second.** Deterministic checks always run, even when the AI is unavailable.
- **The AI never decides a number.** The comparator does. If the rule and the AI disagree on a claim, the finding becomes *Needs human check*.
- **Claims are verified against only the closest approved facts**, which are retrieved in code. The verdict cites a fact ID.
- **A fix validator** rejects any AI rewrite that introduces a number, ranking or banned term that is not in the original text or the cited fact. Rejected rewrites are shown with the reason, not offered as fixes.
- **Every AI-produced finding is labelled** "AI-assisted", with the model and its confidence.
- **Privacy gateway.** Confidential terms, emails, phone numbers and UPI IDs are replaced with placeholders before the AI call and restored afterwards. Facts marked confidential are never sent.
- **Resilient AI calls.** If a model is overloaded, rate-limited or slow, the request falls through to the next model (Gemini 2.5 Flash → 2.5 Flash-Lite → Flash latest) within one shared time budget, and a model that just failed is tried last for a while. If claim verification does not finish, tone and messaging results are still returned and the page says so.
- **Prompt-injection defence.** Draft text is passed as delimited data with an instruction to ignore embedded instructions. Output must match a JSON schema, and quotes that do not exist in the draft are discarded.

## Workflow

`Draft → Run review → resolve findings → Submit → In review → Approve | Request changes → (back to Draft)`

- **Creator** (Priya): edits text, runs reviews, accepts, edits or dismisses fixes, submits.
- **Reviewer** (Arjun): comments, approves or requests changes. Cannot approve while a blocker is open.
- **Brand Manager** (Meera): everything a reviewer can do, plus overriding blockers with a written reason, editing the Brand Kit and reopening approved items.
- Every change creates a **version** with a word-level diff. Every action goes into the **audit log**. An approval records the **facts the content relies on**.

## Architecture

```
Browser (static, ES modules, no build step)
 ├─ js/checks/engine.js     deterministic rules, merge of AI results, image findings
 ├─ js/checks/claims.js     claim detection, fact grounding, qualifier-aware comparator
 ├─ js/checks/validate.js   fix validator
 ├─ js/lib/                 text/number parsing, BM25 retrieval, colour maths (CIEDE2000, WCAG, k-means), word diff
 ├─ js/store.js             per-visitor workspace (localStorage), workflow, permissions, versions, audit
 └─ js/views/               queue, draft review desk, Brand Kit, activity
Serverless functions (Vercel, Node)
 ├─ api/review.js           extract claims + tone issues → retrieve facts → verify claims (Gemini, JSON schema)
 ├─ api/alt-text.js         alt text, visible text and text/background colours from an image
 ├─ api/import-kit.js       propose rules/terms/facts from brand-guide text (confirmed by a person)
 ├─ api/health.js           whether AI checks are configured
 └─ api/_lib/               Gemini REST adapter, privacy redaction, caching, rate limiting
```

## Run it locally

Requirements: Node 18 or later. There are no npm dependencies.

```bash
npm run dev:mock                          # canned AI answers, no key needed → http://localhost:3000
GEMINI_API_KEY=your-key npm run dev       # real Gemini
npm test                                  # unit tests (node --test)
python3 tests/e2e_smoke.py http://localhost:3000   # browser journeys (need Playwright)
python3 tests/e2e_more.py http://localhost:3000
```

## Deploy (Vercel)

1. Import this repository in Vercel. Use framework preset **Other**, with no build command and no output directory.
2. Add the environment variable `GEMINI_API_KEY` (optionally `GEMINI_MODEL`; the default is `gemini-2.5-flash`, falling back to `gemini-2.5-flash-lite` and `gemini-flash-latest`).
3. Deploy. If the key is missing or the AI is down, the app still works with rule-based checks and says so.

## Testing

- **Unit tests** (16 in total). `tests/engine.test.js` (11 tests) covers:
  - number parsing (Indian formats, units, qualifiers);
  - comparator qualifiers;
  - the planted problems in each demo draft;
  - clean approved drafts;
  - the validator rejecting invented numbers and rankings;
  - AI merging (the comparator wins, bad rewrites are rejected);
  - image findings;
  - colour maths and diffs.

  `tests/gemini.test.js` (5 tests) replaces the network with a fake and covers an overloaded model falling through to the next, rate limits on every model, a hanging model abandoned in time, the shared deadline, and partial results when claim verification fails.
- **End-to-end** (`tests/e2e_smoke.py`, Playwright) covers the full journey:
  - queue → open draft → run review (rules + AI) → validator rejection shown → accept fixes → dismiss with reason → Brand Manager override;
  - submit → switch to Reviewer → approve → version history, activity and Brand Kit pages.
  - The test fails on any browser console error.
- **More end-to-end journeys** (`tests/e2e_more.py`) cover:
  - a Brand Manager adding a banned term that is flagged in the next review;
  - a new draft with an uploaded image (an on-brand image is not flagged for palette);
  - request changes → creator edits → submit is blocked until a fresh review → approve;
  - the workspace surviving a page reload.
- **Also checked in the browser:** rule-only mode with no API key (the app says so and still works), and a phone-width layout (390 px).

## Known limitations

- The workspace is saved in the visitor's browser, so two people do not see each other's changes. **Reset demo** restores the starting state.
- Roles are a switcher, not real accounts.
- Text and images only: DOCX and PDF review, brand-guide PDF upload and logo checks are planned for Round 3. Brand-guide import works from pasted text.
- AI checks depend on Gemini's free tier. Under heavy load the page may say the AI is busy; rule checks still run, and a retry a minute later works. Each address gets 30 AI reviews per 10 minutes.
- The AI can over-flag. In D-103, "Your electricity bill is due today" may be flagged as pressure; it can be dismissed with a reason.
- Image contrast and palette figures are estimates on photos with busy backgrounds.

## Changes from the Round 1 plan

| Plan | Built | Why |
| --- | --- | --- |
| Next.js + FastAPI + Supabase + Redis | Static ES-module front end + Vercel serverless functions; workspace in the browser | Judges must use the product without signing in. A per-visitor sandbox avoids login and avoids judges overwriting each other's work. One solo builder, 48 hours, no server to keep alive. |
| NLI cross-encoder for claim verification | Gemini verification against retrieved facts, plus a deterministic comparator and fix validator | Hosting an NLI model does not fit free serverless limits. The principle is unchanged: no single model decides alone, and numbers are checked in code. |
| PaddleOCR for text in images | Gemini reads the visible text; contrast is computed with the WCAG formula; palette uses k-means + CIEDE2000 in the browser | No OCR server needed, and the colour maths stays deterministic. |
| Brand-guide PDF import | Paste brand-guide text → AI proposes rules, terms and facts → a Brand Manager ticks and confirms each | PDF parsing moves to Round 3 together with document review. |
| Multi-user shared database | Single-browser workspace with a role switcher | Same workflow and permissions. A shared database is a post-event step. |

## Three improvements for Round 3

1. **Document review: DOCX and PDF**, with findings pinned to the page and paragraph, and **logo checks** (approved logo versions, colour, distortion, clear space). This includes brand-guide PDF import.
2. **Governance insights.** These include:
   - repeat issues by rule, channel and author;
   - **unclear-rule detection**: rules with high dismissal rates are flagged, with an AI-suggested rewrite;
   - **fact-change alerts**: when a fact is edited or expires, every approved item that relied on it is listed for re-review.
3. **Measured reliability.** Plumbline will gain a labelled evaluation set of at least 60 drafts with planted errors, reporting precision and recall per check before and after the work. It will also feed reviewer dismissals back into per-rule thresholds, so false positives drop.

## Disclosures

- **AI used at runtime:** Google Gemini via the REST API (claim extraction, claim verification, tone and messaging checks, alt text, reading text in images, brand-guide import). Every AI result in the interface is labelled.
- **AI used while building:** the code was written with significant help from an AI coding assistant (Claude, by Anthropic), under my direction. I designed the product, its rules and the review workflow, and I reviewed and tested what was produced.
- **Third-party assets:** IBM Plex fonts (Google Fonts, SIL Open Font License). No UI templates, component libraries or boilerplate were used, and no code written before the build window was reused.
- **Demo data:** NimbuPay, its figures, people and partner bank are fictional.

## Author

Tellakula Someswararao · B.E. Information Technology, Vasavi College of Engineering (Autonomous), Hyderabad · someshtellakula@gmail.com
