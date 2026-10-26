// Demo workspace: a fictional UPI payments brand, "NimbuPay".
// Every name, figure and bank here is invented for the demo.

export const ACTORS = {
  creator: { name: 'Priya', role: 'creator', label: 'Creator' },
  reviewer: { name: 'Arjun', role: 'reviewer', label: 'Reviewer' },
  manager: { name: 'Meera', role: 'manager', label: 'Brand Manager' },
};

export function seedWorkspace(now = new Date()) {
  const iso = (daysAgo, hours = 0) => new Date(now.getTime() - daysAgo * 864e5 - hours * 36e5).toISOString();

  const rules = [
    { id: 'TRM-01', category: 'Terminology', title: 'Write the brand name as "NimbuPay"', description: 'One word, capital N and capital P. Never "Nimbupay", "Nimbu Pay" or "NIMBUPAY".', severity: 'low', engine: 'rule', example: 'Pay with NimbuPay.' },
    { id: 'TRM-02', category: 'Terminology', title: 'Banned words and phrases', description: 'Do not use words that over-promise or trivialise money decisions (see the terminology list).', severity: 'high', engine: 'rule', example: 'Avoid "cheapest", "risk-free", "no-brainer".' },
    { id: 'TRM-03', category: 'Terminology', title: 'Use preferred product terms', description: 'Use the approved product vocabulary so every channel describes features the same way.', severity: 'low', engine: 'rule', example: '"UPI ID", not "UPI address".' },
    { id: 'CLM-01', category: 'Claims', title: 'Numbers must match the fact ledger', description: 'Every statistic, price, count or duration must match an approved fact. A different number is a blocker.', severity: 'blocker', engine: 'hybrid', example: 'Use the current user count from F-001.' },
    { id: 'CLM-02', category: 'Claims', title: 'Rankings and superlatives need an approved source', description: '"Fastest", "best", "No. 1", "India\'s first" and similar claims need a ledger fact that proves them.', severity: 'high', engine: 'hybrid', example: 'Say "payments confirm in about 2 seconds" instead of "fastest".' },
    { id: 'CLM-03', category: 'Claims', title: 'No guaranteed outcomes', description: 'Never guarantee rewards, returns or zero failures. Offers depend on terms.', severity: 'blocker', engine: 'rule', example: '"Get up to ₹100 cashback", not "guaranteed cashback".' },
    { id: 'CLM-04', category: 'Claims', title: 'Facts must be current', description: 'A claim that relies on an expired fact must be re-confirmed by the fact owner before publishing.', severity: 'high', engine: 'rule', example: 'Check the expiry date in the fact ledger.' },
    { id: 'TON-01', category: 'Tone', title: 'Friendly and confident, never hype', description: 'Talk like a helpful neighbour who knows money. No ALL CAPS shouting and at most one exclamation mark per piece.', severity: 'low', engine: 'hybrid', example: 'Calm, specific, useful.' },
    { id: 'TON-02', category: 'Tone', title: 'No fear, shame or pressure about money', description: 'Do not frighten, shame or rush people into paying or downloading.', severity: 'high', engine: 'ai', example: 'Say "Your bill is due today" rather than "Don\'t lose money!"' },
    { id: 'TON-03', category: 'Tone', title: 'Never name competitors', description: 'Talk about what NimbuPay does well, not about other apps.', severity: 'high', engine: 'rule', example: 'Remove comparisons with other payment apps.' },
    { id: 'TON-04', category: 'Tone', title: 'Keep sentences short', description: 'Keep sentences under 30 words so they work on small screens and for people reading in a second language.', severity: 'low', engine: 'rule', example: 'Split long sentences in two.' },
    { id: 'MSG-01', category: 'Messaging', title: 'Lead with one key message', description: 'Promotional content should carry at least one key message: fast, secure or simple.', severity: 'low', engine: 'ai', example: 'See the tone profile for the key messages.' },
    { id: 'LEG-01', category: 'Legal', title: 'Offers must say "T&C apply"', description: 'Any cashback, discount or offer must include "T&C apply".', severity: 'high', engine: 'rule', example: 'Get up to ₹100 cashback. T&C apply.' },
    { id: 'ACC-01', category: 'Accessibility', title: 'Every image needs alt text', description: 'Describe what the image shows and any text in it, for screen-reader users.', severity: 'high', engine: 'rule', example: 'Alt: "Green card reading: Pay bills in one tap".' },
    { id: 'ACC-02', category: 'Accessibility', title: 'Text contrast at least 4.5:1', description: 'Text in images must meet WCAG 2.2 AA contrast against its background.', severity: 'medium', engine: 'rule', example: 'Mist text on Forest background passes.' },
    { id: 'VIS-01', category: 'Visual', title: 'Use brand palette colours', description: 'Large areas of colour in creatives must come from the brand palette.', severity: 'medium', engine: 'rule', example: 'Forest, Lime, Mist, Ink, Saffron.' },
    { id: 'CNF-01', category: 'Confidentiality', title: 'Never mention unreleased projects', description: 'Confidential project names must not appear in any external content.', severity: 'blocker', engine: 'rule', example: 'See confidential terms in the tone profile.' },
  ].map((r) => ({ ...r, active: true, owner: 'Meera (Brand)' }));

  const terms = [
    { id: 'T-01', term: 'cheapest', kind: 'banned', replacement: 'great value', ruleId: 'TRM-02' },
    { id: 'T-02', term: 'risk-free', kind: 'banned', replacement: 'secure', ruleId: 'TRM-02' },
    { id: 'T-03', term: 'no-brainer', kind: 'banned', replacement: 'an easy choice', ruleId: 'TRM-02' },
    { id: 'T-04', term: 'guaranteed returns', kind: 'banned', replacement: '', ruleId: 'TRM-02' },
    { id: 'T-05', term: '100% safe', kind: 'banned', replacement: 'protected by your UPI PIN', ruleId: 'TRM-02' },
    { id: 'T-06', term: 'UPI address', kind: 'replace', replacement: 'UPI ID', ruleId: 'TRM-03' },
    { id: 'T-07', term: 'e-wallet', kind: 'replace', replacement: 'UPI app', ruleId: 'TRM-03' },
    { id: 'T-08', term: 'signup', kind: 'replace', replacement: 'sign up', ruleId: 'TRM-03' },
    { id: 'T-09', term: 'PhonePe', kind: 'competitor', replacement: '', ruleId: 'TON-03' },
    { id: 'T-10', term: 'Paytm', kind: 'competitor', replacement: '', ruleId: 'TON-03' },
    { id: 'T-11', term: 'Google Pay', kind: 'competitor', replacement: '', ruleId: 'TON-03' },
    { id: 'T-12', term: 'GPay', kind: 'competitor', replacement: '', ruleId: 'TON-03' },
  ];

  const facts = [
    { id: 'F-001', statement: 'NimbuPay has 4.2 million registered users.', metric: 'registered users', keywords: ['users', 'customers', 'registered', 'trusted by', 'people'], quantity: { value: 4.2e6, unitType: 'count', qualifier: 'exact' }, display: '4.2 million', source: 'Internal analytics dashboard, 30 Sep 2026', owner: 'Growth team', updated: '2026-10-01', expires: '2026-12-31' },
    { id: 'F-002', statement: 'A NimbuPay UPI payment confirms in about 2 seconds on average.', metric: 'payment confirmation time', keywords: ['seconds', 'confirm', 'fast', 'fastest', 'quick', 'instant', 'speed'], quantity: { value: 2, unitType: 'seconds', qualifier: 'approx' }, display: 'about 2 seconds', source: 'Internal latency test, August 2026', owner: 'Engineering', updated: '2026-08-20', expires: '2027-02-28' },
    { id: 'F-003', statement: 'NimbuPay payments are processed through Kaveri Bank, an RBI-regulated partner bank.', metric: 'partner bank', keywords: ['bank', 'rbi', 'regulated', 'partner'], quantity: null, display: '', source: 'Partner agreement', owner: 'Legal', updated: '2026-04-01', expires: '' },
    { id: 'F-004', statement: 'New users get up to ₹100 cashback on their first UPI payment, valid till 31 Dec 2026. T&C apply.', metric: 'first payment cashback', keywords: ['cashback', 'first', 'offer', 'reward'], quantity: { value: 100, unitType: 'currency', qualifier: 'upTo' }, display: 'up to ₹100', source: 'Diwali 2026 offer approval', owner: 'Marketing', updated: '2026-10-05', expires: '2026-12-31' },
    { id: 'F-005', statement: 'NimbuPay QR is accepted at more than 2,50,000 merchants.', metric: 'merchants', keywords: ['merchants', 'shops', 'stores', 'accepted'], quantity: { value: 250000, unitType: 'count', qualifier: 'atLeast' }, display: '2,50,000+', source: 'Merchant network report, June 2026', owner: 'Merchant team', updated: '2026-06-30', expires: '2026-09-30' },
    { id: 'F-006', statement: 'NimbuPay is rated 4.6 out of 5 on Google Play.', metric: 'app rating', keywords: ['rating', 'rated', 'stars', 'google play', 'play store'], quantity: { value: 4.6, unitType: 'rating', qualifier: 'exact' }, display: '4.6', source: 'Google Play listing, 12 Oct 2026', owner: 'Growth team', updated: '2026-10-12', expires: '2026-11-30' },
    { id: 'F-007', statement: 'The NimbuPay app is available in 8 Indian languages.', metric: 'languages', keywords: ['languages', 'language', 'indian languages'], quantity: { value: 8, unitType: 'count', qualifier: 'exact' }, display: '8', source: 'Release notes v7.2', owner: 'Product', updated: '2026-09-15', expires: '' },
    { id: 'F-008', statement: 'NimbuPay supports electricity, mobile recharge, DTH and water bill payments.', metric: 'bill categories', keywords: ['bill', 'bills', 'electricity', 'dth', 'recharge', 'water'], quantity: null, display: '', source: 'Product catalogue', owner: 'Product', updated: '2026-07-01', expires: '' },
    { id: 'F-009', statement: 'Every NimbuPay payment needs the UPI PIN, and accounts are bound to the registered device.', metric: 'security', keywords: ['pin', 'device', 'secure', 'security', 'protected', 'safe'], quantity: null, display: '', source: 'Security whitepaper', owner: 'Security', updated: '2026-05-10', expires: '' },
    { id: 'F-010', statement: 'NimbuPay offers 24x7 in-app chat support.', metric: 'support hours', keywords: ['support', 'chat', '24x7', 'round-the-clock', 'help'], quantity: null, display: '', source: 'Support policy', owner: 'Customer support', updated: '2026-03-01', expires: '' },
    { id: 'F-011', statement: 'Project Lime: a NimbuPay credit line, launching January 2027 (internal only).', metric: 'roadmap', keywords: ['project lime', 'credit line'], quantity: null, display: '', source: 'Board roadmap', owner: 'Strategy', updated: '2026-10-01', expires: '', confidential: true },
  ].map((f) => ({ confidential: false, ...f }));

  const palette = [
    { name: 'Forest', hex: '#1F4D2B' },
    { name: 'Lime', hex: '#8CC63F' },
    { name: 'Mist', hex: '#F4F7EF' },
    { name: 'Ink', hex: '#1B1F1D' },
    { name: 'Saffron', hex: '#F2A93B' },
    { name: 'White', hex: '#FFFFFF' },
  ];

  const tone = {
    voice: 'Friendly, clear and confident. Talk like a helpful neighbour who knows money, not a salesperson.',
    do: ['Use short, plain sentences', 'Explain the benefit to the reader', 'Use "you" and "your"', 'Be specific: real numbers from the fact ledger'],
    dont: ['Hype, ALL CAPS or several exclamation marks', 'Fear, shame or pressure about money', 'Comparisons with other apps', 'Promises the product cannot keep'],
    keyMessages: ['Fast: payments confirm in about 2 seconds', 'Secure: every payment needs your UPI PIN', 'Simple: bills, recharges and transfers in one app'],
    confidentialTerms: ['Project Lime', 'credit line'],
  };

  const drafts = [
    {
      id: 'D-101', title: 'Diwali cashback: Instagram post', channel: 'Instagram', author: 'Priya', status: 'draft', createdAt: iso(1, 3), updatedAt: iso(0, 5),
      body: "Nimbupay is India's fastest UPI app, trusted by 5 million users across the country!!! This Diwali, get guaranteed ₹200 cashback on your first UPI payment, way better than PhonePe. Pay your bills, split dinners and send money home in seconds. It's a no-brainer, so download now before the offer ends!",
      image: { src: 'assets/diwali-banner.png', name: 'diwali-banner.png', alt: '' },
    },
    {
      id: 'D-102', title: 'Bill payments: blog introduction', channel: 'Blog', author: 'Priya', status: 'draft', createdAt: iso(2, 1), updatedAt: iso(1, 2),
      body: 'Paying electricity, mobile and DTH bills with NimbuPay takes less than a minute. Our app is accepted at over 2,50,000 merchants and supports 8 Indian languages, so your whole family can use it. Every payment is protected by your UPI PIN and device binding, and our partner bank is regulated by the RBI. With a 4.6 rating on Google Play and round-the-clock chat support, NimbuPay is built to make everyday payments simple, secure and stress-free for households in every city and town across India, whether you are paying a small recharge or a large electricity bill at the end of the month.',
      image: null,
    },
    {
      id: 'D-103', title: 'Bill reminder: push notification', channel: 'Push notification', author: 'Priya', status: 'draft', createdAt: iso(0, 9), updatedAt: iso(0, 9),
      body: "Don't be the one who loses money! Your electricity bill is due today, so pay now with Nimbu Pay or face penalties. P.S. Something big is coming: Project Lime launches soon.",
      image: null,
    },
    {
      id: 'D-104', title: 'Cashback offer: email newsletter', channel: 'Email', author: 'Priya', status: 'changes_requested', createdAt: iso(3, 2), updatedAt: iso(1, 6),
      body: 'New to NimbuPay? Get up to ₹100 cashback on your first UPI payment. Pay bills, recharge your phone and send money in one simple app. T&C apply.',
      image: null,
    },
    {
      id: 'D-105', title: 'How we protect you: LinkedIn post', channel: 'LinkedIn', author: 'Priya', status: 'approved', createdAt: iso(5, 4), updatedAt: iso(4, 1),
      body: 'Your money deserves more than a promise. Every NimbuPay payment needs your UPI PIN, and your account is bound to your device. Payments are processed through our RBI-regulated partner bank. Read how we keep your account safe at nimbupay.example/security.',
      image: { src: 'assets/security-card.png', name: 'security-card.png', alt: 'Dark green card with the text "Every payment needs your UPI PIN" and a lime padlock icon.' },
    },
  ].map((d) => ({
    versions: [], findings: [], comments: [], factRefs: [], needsReview: true, lastReview: null, approvedBy: null, approvedAt: null,
    ...d,
  }));

  // History for the drafts that are already further along the workflow.
  const d104 = drafts.find((d) => d.id === 'D-104');
  d104.versions = [
    { n: 1, body: 'New to NimbuPay? Get ₹100 cashback on your first UPI payment! Pay bills, recharge your phone and send money in one simple app.', at: iso(3, 2), by: 'Priya', note: 'Created' },
    { n: 2, body: d104.body, at: iso(2, 20), by: 'Priya', note: 'Accepted fixes for CLM-01 and LEG-01' },
  ];
  d104.needsReview = false;
  d104.lastReview = { at: iso(2, 20), ai: 'ok', model: 'gemini', counts: { blocker: 0, high: 0, medium: 0, low: 0 } };
  d104.comments = [
    { id: 'C-1', by: 'Priya', role: 'creator', text: 'Fixed the cashback wording and added T&C. Ready for review.', at: iso(2, 19) },
    { id: 'C-2', by: 'Arjun', role: 'reviewer', text: 'Please add the offer end date (31 Dec 2026) so readers know how long it runs.', at: iso(1, 6) },
  ];

  const d105 = drafts.find((d) => d.id === 'D-105');
  d105.versions = [
    { n: 1, body: 'Your money deserves more than a promise. NimbuPay is 100% secure: every payment needs your UPI PIN, and your account is bound to your device. Payments are processed through our RBI-regulated partner bank. Read how we keep your account safe at nimbupay.example/security.', at: iso(5, 4), by: 'Priya', note: 'Created' },
    { n: 2, body: d105.body, at: iso(4, 22), by: 'Priya', note: 'Accepted fix for CLM-03' },
  ];
  d105.needsReview = false;
  d105.lastReview = { at: iso(4, 22), ai: 'ok', model: 'gemini', counts: { blocker: 0, high: 0, medium: 0, low: 0 } };
  d105.findings = [
    { id: 'X-1', source: 'rule', category: 'Claims', severity: 'blocker', ruleId: 'CLM-03', factId: 'F-009', title: 'Guaranteed outcome', quote: 'NimbuPay is 100% secure: every', reason: '"100% secure" is an absolute guarantee. The ledger supports PIN and device binding, not zero risk.', fix: { replacement: 'Every', note: 'Lead with the protection the ledger supports (F-009).' }, confidence: 1, status: 'accepted', resolution: { by: 'Priya', at: iso(4, 22), reason: '' }, target: 'text' },
  ];
  d105.comments = [{ id: 'C-3', by: 'Meera', role: 'manager', text: 'Approved. Good use of the security facts.', at: iso(4, 1) }];
  d105.factRefs = ['F-003', 'F-009'];
  d105.approvedBy = 'Meera';
  d105.approvedAt = iso(4, 1);

  for (const d of drafts) if (!d.versions.length) d.versions = [{ n: 1, body: d.body, at: d.createdAt, by: d.author, note: 'Created' }];

  const audit = [
    { at: iso(5, 4), actor: 'Priya', role: 'creator', action: 'Created draft', draftId: 'D-105', detail: '' },
    { at: iso(4, 22), actor: 'Priya', role: 'creator', action: 'Accepted fix', draftId: 'D-105', detail: 'CLM-03: removed "100% secure"' },
    { at: iso(4, 1), actor: 'Meera', role: 'manager', action: 'Approved', draftId: 'D-105', detail: 'Relies on F-003, F-009' },
    { at: iso(3, 2), actor: 'Priya', role: 'creator', action: 'Created draft', draftId: 'D-104', detail: '' },
    { at: iso(2, 19), actor: 'Priya', role: 'creator', action: 'Submitted for review', draftId: 'D-104', detail: '' },
    { at: iso(1, 6), actor: 'Arjun', role: 'reviewer', action: 'Requested changes', draftId: 'D-104', detail: 'Add the offer end date' },
  ];

  return { version: 2, createdAt: now.toISOString(), brand: { name: 'NimbuPay', tagline: 'UPI payments for every household' }, rules, terms, facts, palette, tone, drafts, audit, pendingImport: null, role: 'creator', seq: 200 };
}
