import type { RawLandmark } from '../hand/palm';
import type { FlowerDNA, HandState } from '../types';

export function isDebugEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

const LOW_FPS_THRESHOLD = 24;
const LOW_FPS_SUSTAIN_MS = 3000;

/** Tracks fps continuously (not just when debug is on) so the frame-budget guard in section 9 can act on it. */
export class FpsMonitor {
  fps = 0;
  private frames = 0;
  private windowStartMs = performance.now();
  private lowFpsStartMs: number | null = null;

  tick(nowMs: number): void {
    this.frames++;
    const elapsed = nowMs - this.windowStartMs;
    if (elapsed >= 500) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.windowStartMs = nowMs;
    }
  }

  /** True once, the moment fps has been sustained below threshold for LOW_FPS_SUSTAIN_MS. */
  checkSustainedLowFps(nowMs: number): boolean {
    if (this.fps > 0 && this.fps < LOW_FPS_THRESHOLD) {
      if (this.lowFpsStartMs === null) this.lowFpsStartMs = nowMs;
      if (nowMs - this.lowFpsStartMs > LOW_FPS_SUSTAIN_MS) {
        this.lowFpsStartMs = nowMs;
        return true;
      }
    } else {
      this.lowFpsStartMs = null;
    }
    return false;
  }
}

export class DebugOverlay {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  draw(params: {
    fps: number;
    stage: string;
    hand: HandState | null;
    landmarks: RawLandmark[] | null;
    dna: FlowerDNA | null;
    mirror: boolean;
  }): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#0f0';
    ctx.textBaseline = 'top';

    let y = 8;
    const line = (text: string) => {
      ctx.fillText(text, 8, y);
      y += 14;
    };

    line(`fps: ${params.fps.toFixed(1)}`);
    line(`stage: ${params.stage}`);
    if (params.hand) {
      line(
        `openness: ${params.hand.openness.toFixed(2)}  stability: ${params.hand.stability.toFixed(2)}  tilt: ${params.hand.tilt.toFixed(1)}`,
      );
    }
    if (params.dna) {
      line(`seed: ${params.dna.seed}`);
      line(`hue: ${params.dna.hueCenter.toFixed(0)} spread: ${params.dna.hueSpread.toFixed(2)}`);
      line(`sat: ${params.dna.saturation.toFixed(2)} lum: ${params.dna.luminance.toFixed(2)}`);
      line(`edge: ${params.dna.edgeComplexity.toFixed(2)} aspect: ${params.dna.aspect.toFixed(2)}`);
      line(`petals: ${params.dna.petalCount}`);
    }

    if (params.landmarks) {
      ctx.fillStyle = '#0ff';
      for (const lm of params.landmarks) {
        const nx = params.mirror ? 1 - lm.x : lm.x;
        const x = nx * canvas.width;
        const yy = lm.y * canvas.height;
        ctx.beginPath();
        ctx.arc(x, yy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
