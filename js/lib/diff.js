// Word-level diff (longest common subsequence) for version history and fix previews.

function tokens(s) {
  return String(s).split(/(\s+)/).filter((t) => t.length);
}

/** Returns [{ type: 'eq' | 'del' | 'ins', text }]. */
export function diffWords(a, b) {
  const A = tokens(a), B = tokens(b);
  const n = A.length, m = B.length;
  if (n * m > 400000) return [{ type: 'del', text: a }, { type: 'ins', text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  const push = (type, text) => { const last = out[out.length - 1]; if (last && last.type === type) last.text += text; else out.push({ type, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
    else { push('ins', B[j]); j++; }
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('ins', B[j++]);
  return out;
}
