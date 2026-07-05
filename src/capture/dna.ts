import type { FlowerDNA, UVRect } from '../types';
import { hashBytes } from '../util/rng';

const ALPHA_THRESHOLD = 24; // 0-255, pixels below this are treated as background
const EDGE_THRESHOLD = 40; // Sobel gradient magnitude counted as an "edge"

/** Extracts FlowerDNA once from a matted (RGBA, alpha = matte) capture canvas. */
export function extractFlowerDNA(matted: HTMLCanvasElement): FlowerDNA {
  const w = matted.width;
  const h = matted.height;
  const ctx = matted.getContext('2d')!;
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;

  let hueX = 0;
  let hueY = 0;
  let satSum = 0;
  let lumSum = 0;
  let count = 0;
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const a = data[idx + 3]!;
      if (a < ALPHA_THRESHOLD) continue;

      const r = data[idx]! / 255;
      const g = data[idx + 1]! / 255;
      const b = data[idx + 2]! / 255;
      const { h: hue, s, l } = rgbToHsl(r, g, b);

      const rad = (hue * Math.PI) / 180;
      hueX += Math.cos(rad);
      hueY += Math.sin(rad);
      satSum += s;
      lumSum += l;
      count++;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (count === 0) {
    minX = 0;
    minY = 0;
    maxX = w - 1;
    maxY = h - 1;
    count = 1;
  }

  const hueCenterRad = Math.atan2(hueY, hueX);
  const hueCenter = ((hueCenterRad * 180) / Math.PI + 360) % 360;
  const resultant = Math.sqrt(hueX * hueX + hueY * hueY) / count;
  const hueSpread = clamp01(1 - resultant);
  const saturation = clamp01(satSum / count);
  const luminance = clamp01(lumSum / count);

  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  const aspect = bboxW / bboxH;

  const edgeComplexity = computeEdgeComplexity(image, w, h, minX, minY, maxX, maxY);
  const petalCount = 5 + Math.round(edgeComplexity * 8);

  const seed = hashBytes(data, 97);
  const textureRegions = buildTextureRegions(petalCount, minX / w, minY / h, bboxW / w, bboxH / h, seed);

  return {
    seed,
    hueCenter,
    hueSpread,
    saturation,
    luminance,
    edgeComplexity,
    aspect,
    petalCount,
    textureRegions,
  };
}

function computeEdgeComplexity(
  image: ImageData,
  w: number,
  h: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  const data = image.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!;
  }

  let edgeCount = 0;
  let total = 0;

  for (let y = Math.max(1, minY); y < Math.min(h - 1, maxY); y++) {
    for (let x = Math.max(1, minX); x < Math.min(w - 1, maxX); x++) {
      const alpha = data[(y * w + x) * 4 + 3]!;
      if (alpha < ALPHA_THRESHOLD) continue;

      const gx =
        -gray[(y - 1) * w + (x - 1)]! + gray[(y - 1) * w + (x + 1)]! +
        -2 * gray[y * w + (x - 1)]! + 2 * gray[y * w + (x + 1)]! +
        -gray[(y + 1) * w + (x - 1)]! + gray[(y + 1) * w + (x + 1)]!;
      const gy =
        -gray[(y - 1) * w + (x - 1)]! - 2 * gray[(y - 1) * w + x]! - gray[(y - 1) * w + (x + 1)]! +
        gray[(y + 1) * w + (x - 1)]! + 2 * gray[(y + 1) * w + x]! + gray[(y + 1) * w + (x + 1)]!;

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      total++;
      if (magnitude > EDGE_THRESHOLD) edgeCount++;
    }
  }

  return total > 0 ? clamp01(edgeCount / total) : 0;
}

function buildTextureRegions(
  petalCount: number,
  bboxU: number,
  bboxV: number,
  bboxW: number,
  bboxH: number,
  seed: number,
): UVRect[] {
  const cols = Math.ceil(Math.sqrt(petalCount));
  const rows = Math.ceil(petalCount / cols);
  const cellW = bboxW / cols;
  const cellH = bboxH / rows;

  const regions: UVRect[] = [];
  for (let i = 0; i < petalCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols) % rows;
    // deterministic per-seed jitter so regions don't look identically gridded
    const jitterSeedX = ((seed >> (i % 24)) & 0xff) / 255;
    const jitterSeedY = ((seed >> ((i * 3) % 24)) & 0xff) / 255;
    const jitterX = (jitterSeedX - 0.5) * cellW * 0.2;
    const jitterY = (jitterSeedY - 0.5) * cellH * 0.2;

    regions.push({
      u: bboxU + col * cellW + jitterX,
      v: bboxV + row * cellH + jitterY,
      w: cellW,
      h: cellH,
    });
  }
  return regions;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / d + 2) * 60;
      break;
    default:
      h = ((r - g) / d + 4) * 60;
  }

  return { h, s, l };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
