import * as THREE from 'three';

// Builds a height map from a matted (RGBA, alpha = matte) capture so a flat
// photo can be displaced into a lit relief. Height = interior-ness (a heavily
// blurred alpha mask, a cheap distance-to-edge proxy that domes the shape)
// blended with luminance (bright body raised). Same pixel/luminance/alpha
// conventions as src/capture/dna.ts.

const RES = 128;
const ALPHA_THRESHOLD = 24;
const BLUR_RADIUS = 11; // interior falloff width in grid cells
const BLUR_PASSES = 2;

export interface Relief {
  heightTex: THREE.DataTexture;
  aspect: number;
}

export function buildRelief(matted: HTMLCanvasElement): Relief {
  const small = document.createElement('canvas');
  small.width = RES;
  small.height = RES;
  const sctx = small.getContext('2d')!;
  sctx.drawImage(matted, 0, 0, RES, RES);
  const data = sctx.getImageData(0, 0, RES, RES).data;

  const mask = new Float32Array(RES * RES);
  const lum = new Float32Array(RES * RES);
  for (let i = 0; i < RES * RES; i++) {
    const a = data[i * 4 + 3]!;
    mask[i] = a >= ALPHA_THRESHOLD ? 1 : 0;
    lum[i] = (0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!) / 255;
  }

  const interior = mask;
  for (let p = 0; p < BLUR_PASSES; p++) boxBlur(interior, RES, RES, BLUR_RADIUS);

  // interior domes the shape; luminance adds gentle, mostly-smooth relief
  const height = new Float32Array(RES * RES);
  for (let i = 0; i < RES * RES; i++) {
    height[i] = interior[i]! * (0.65 + 0.35 * lum[i]!);
  }
  // smooth the combined relief so surface normals read as a form, not per-pixel
  // noise (raw per-pixel luminance detail is what looked like "pixel dropping")
  boxBlur(height, RES, RES, 4);
  boxBlur(height, RES, RES, 4);

  let max = 1e-6;
  for (let i = 0; i < RES * RES; i++) {
    if (height[i]! > max) max = height[i]!;
  }

  const pixels = new Uint8Array(RES * RES * 4);
  for (let i = 0; i < RES * RES; i++) {
    const v = Math.round(Math.min(1, height[i]! / max) * 255);
    pixels[i * 4] = v;
    pixels[i * 4 + 1] = v;
    pixels[i * 4 + 2] = v;
    pixels[i * 4 + 3] = 255;
  }

  const heightTex = new THREE.DataTexture(pixels, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = THREE.ClampToEdgeWrapping;
  heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  return { heightTex, aspect: matted.width / matted.height };
}

/** Separable box blur in place (two axes per call). */
function boxBlur(buf: Float32Array, w: number, h: number, radius: number): void {
  const tmp = new Float32Array(buf.length);
  const norm = 1 / (radius * 2 + 1);
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        sum += buf[y * w + xx]!;
      }
      tmp[y * w + x] = sum * norm;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.max(0, Math.min(h - 1, y + k));
        sum += tmp[yy * w + x]!;
      }
      buf[y * w + x] = sum * norm;
    }
  }
}
