import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const WASM_BASE = `${import.meta.env.BASE_URL}vendor/mediapipe-wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/selfie_segmenter.tflite`;

let segmenter: ImageSegmenter | null = null;

export async function initSegmenter(): Promise<ImageSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate: 'GPU',
    },
    runningMode: 'IMAGE',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  return segmenter;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

const CONFIDENCE_MARGIN = 0.15;
const FEATHER_BLUR_PX = 5;

/**
 * Mattes the central subject out of `source` and returns a same-size canvas
 * with alpha carrying the matte. Never blocks: worst case the whole frame
 * becomes opaque and is used as-is downstream.
 */
export async function segmentFrame(
  source: HTMLCanvasElement,
  pinchPoint: NormalizedPoint,
): Promise<HTMLCanvasElement> {
  const confidence = segmenter ? runSegmenter(source) : null;

  if (confidence && hasGoodSeparation(confidence, source.width, source.height)) {
    return applyAlphaMask(source, confidence, source.width, source.height);
  }

  return radialLuminanceMatte(source, pinchPoint);
}

function runSegmenter(source: HTMLCanvasElement): Float32Array | null {
  if (!segmenter) return null;
  let result: Float32Array | null = null;
  segmenter.segment(source, (r) => {
    const mask = r.confidenceMasks?.[0];
    if (mask) {
      result = mask.getAsFloat32Array();
      mask.close();
    }
    r.close();
  });
  return result;
}

function hasGoodSeparation(confidence: Float32Array, w: number, h: number): boolean {
  const borderMean = sampleRegionMean(confidence, w, h, (x, y) => x < w * 0.08 || x > w * 0.92 || y < h * 0.08 || y > h * 0.92);
  const centerMean = sampleRegionMean(confidence, w, h, (x, y) => {
    const dx = x / w - 0.5;
    const dy = y / h - 0.5;
    return dx * dx + dy * dy < 0.15 * 0.15;
  });
  return centerMean - borderMean > CONFIDENCE_MARGIN;
}

function sampleRegionMean(
  data: Float32Array,
  w: number,
  h: number,
  inRegion: (x: number, y: number) => boolean,
): number {
  let sum = 0;
  let count = 0;
  const stepX = Math.max(1, Math.floor(w / 64));
  const stepY = Math.max(1, Math.floor(h / 64));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      if (inRegion(x, y)) {
        sum += data[y * w + x]!;
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

function applyAlphaMask(source: HTMLCanvasElement, confidence: Float32Array, w: number, h: number): HTMLCanvasElement {
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d')!;
  const maskImage = maskCtx.createImageData(w, h);
  for (let i = 0; i < confidence.length; i++) {
    const a = Math.round(clamp01(confidence[i]!) * 255);
    maskImage.data[i * 4 + 3] = a;
  }
  maskCtx.putImageData(maskImage, 0, 0);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const outCtx = out.getContext('2d')!;
  outCtx.drawImage(source, 0, 0, w, h);
  outCtx.globalCompositeOperation = 'destination-in';
  outCtx.filter = `blur(${FEATHER_BLUR_PX}px)`;
  outCtx.drawImage(maskCanvas, 0, 0, w, h);
  outCtx.filter = 'none';
  outCtx.globalCompositeOperation = 'source-over';
  return out;
}

function radialLuminanceMatte(source: HTMLCanvasElement, pinchPoint: NormalizedPoint): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const srcCtx = source.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, w, h);

  const cx = pinchPoint.x * w;
  const cy = pinchPoint.y * h;
  const radius = Math.min(w, h) * 0.42;

  const borderColor = averageBorderColor(srcData, w, h);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d')!;
  const maskImage = maskCtx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radial = 1 - clamp01(dist / radius);

      const r = srcData.data[idx * 4]!;
      const g = srcData.data[idx * 4 + 1]!;
      const b = srcData.data[idx * 4 + 2]!;
      const colorDist = Math.sqrt(
        (r - borderColor.r) ** 2 + (g - borderColor.g) ** 2 + (b - borderColor.b) ** 2,
      ) / 255;

      const alpha = clamp01(radial * (0.4 + 0.6 * clamp01(colorDist * 2)));
      maskImage.data[idx * 4 + 3] = Math.round(alpha * 255);
    }
  }
  maskCtx.putImageData(maskImage, 0, 0);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const outCtx = out.getContext('2d')!;
  outCtx.drawImage(source, 0, 0, w, h);
  outCtx.globalCompositeOperation = 'destination-in';
  outCtx.filter = `blur(${FEATHER_BLUR_PX}px)`;
  outCtx.drawImage(maskCanvas, 0, 0, w, h);
  outCtx.filter = 'none';
  outCtx.globalCompositeOperation = 'source-over';
  return out;
}

function averageBorderColor(data: ImageData, w: number, h: number): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const margin = Math.round(Math.min(w, h) * 0.05);
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      if (x < margin || x > w - margin || y < margin || y > h - margin) {
        const idx = (y * w + x) * 4;
        r += data.data[idx]!;
        g += data.data[idx + 1]!;
        b += data.data[idx + 2]!;
        count++;
      }
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / count, g: g / count, b: b / count };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
