// Browser-side image analysis: dominant colours (k-means), an estimated text contrast,
// and a downscaled JPEG/PNG data URL for the AI reader. Runs locally; no upload needed.
import { kmeans, contrastRatio } from './lib/color.js';

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the image.'));
    img.src = src;
  });
}

export async function analyzeImage(src) {
  const img = await loadImage(src);
  const scale = Math.min(1, 140 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) pixels.push([data[i], data[i + 1], data[i + 2]]);
  const clusters = kmeans(pixels, 6);
  const bg = clusters[0];
  let best = null;
  for (const c of clusters.slice(1)) {
    if (c.share < 0.015) continue;
    const ratio = contrastRatio(c.rgb, bg.rgb);
    if (!best || ratio > best.ratio) best = { ratio, fg: c.hex, bg: bg.hex };
  }
  return { clusters, estimatedContrast: best, width: img.naturalWidth, height: img.naturalHeight };
}

/** Downscale an image to a data URL (keeps localStorage small and AI uploads quick). */
export async function toDataUrl(src, max = 1024, type = 'image/jpeg') {
  const img = await loadImage(src);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.86);
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsText(file);
  });
}
