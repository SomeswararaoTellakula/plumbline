// Colour maths: hex/RGB/Lab conversion, CIEDE2000 distance, WCAG contrast and k-means.

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two colours (1 to 21). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(typeof a === 'string' ? hexToRgb(a) : a);
  const lb = relativeLuminance(typeof b === 'string' ? hexToRgb(b) : b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function rgbToLab([r, g, b]) {
  let [x, y, z] = [r, g, b].map((v) => {
    const s = v / 255;
    return s > 0.04045 ? ((s + 0.055) / 1.055) ** 2.4 : s / 12.92;
  });
  const X = (x * 0.4124 + y * 0.3576 + z * 0.1805) / 0.95047;
  const Y = x * 0.2126 + y * 0.7152 + z * 0.0722;
  const Z = (x * 0.0193 + y * 0.1192 + z * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference. Below ~2 is hard to see; above ~10 is clearly different. */
export function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (a, b) => { if (a === 0 && b === 0) return 0; const v = Math.atan2(b, a) / rad; return v >= 0 ? v : v + 360; };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

/** Nearest palette colour to an RGB value, with its CIEDE2000 distance. */
export function nearestPaletteColour(rgb, palette) {
  const lab = rgbToLab(rgb);
  let best = null;
  for (const p of palette) {
    const d = deltaE2000(lab, rgbToLab(hexToRgb(p.hex)));
    if (!best || d < best.distance) best = { ...p, distance: d };
  }
  return best;
}

/**
 * Deterministic k-means over RGB pixels (k-means++ style seeding without randomness).
 * Returns clusters sorted by share: [{ rgb, hex, share }].
 */
export function kmeans(pixels, k = 5, iterations = 12) {
  if (!pixels.length) return [];
  const centres = [pixels[0].slice()];
  while (centres.length < k && centres.length < pixels.length) {
    let far = null, farD = -1;
    for (let i = 0; i < pixels.length; i += Math.max(1, Math.floor(pixels.length / 2000))) {
      const p = pixels[i];
      let d = Infinity;
      for (const c of centres) d = Math.min(d, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2);
      if (d > farD) { farD = d; far = p; }
    }
    if (!far || farD === 0) break;
    centres.push(far.slice());
  }
  const assign = new Array(pixels.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = (p[0] - centres[c][0]) ** 2 + (p[1] - centres[c][1]) ** 2 + (p[2] - centres[c][2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; sums[best][3]++;
    }
    for (let c = 0; c < centres.length; c++) if (sums[c][3]) centres[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
  }
  const counts = centres.map(() => 0);
  for (const a of assign) counts[a]++;
  return centres
    .map((c, i) => ({ rgb: c.map(Math.round), hex: rgbToHex(c), share: counts[i] / pixels.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}
