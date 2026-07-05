import { pinchDistance } from '../hand/gestures';
import type { RawLandmark } from '../hand/palm';

const PINCH_THRESHOLD = 0.06; // normalized landmark units, thumb-tip (4) to index-tip (8)
const HOLD_MS = 600;

/** Pinch held 600ms fires the shutter. A fallback tap button always exists alongside this (accessibility, teaching contexts). */
export class ShutterController {
  private pinchStartMs: number | null = null;
  private fired = false;
  private progress = 0;

  /** Returns true exactly once, the frame the hold completes. */
  update(landmarks: RawLandmark[] | null, timestampMs: number): boolean {
    if (!landmarks || pinchDistance(landmarks) >= PINCH_THRESHOLD) {
      this.pinchStartMs = null;
      this.fired = false;
      this.progress = 0;
      return false;
    }

    if (this.pinchStartMs === null) {
      this.pinchStartMs = timestampMs;
    }

    const held = timestampMs - this.pinchStartMs;
    this.progress = Math.max(0, Math.min(1, held / HOLD_MS));

    if (this.fired) return false;
    if (held >= HOLD_MS) {
      this.fired = true;
      return true;
    }
    return false;
  }

  get holdProgress(): number {
    return this.progress;
  }

  reset(): void {
    this.pinchStartMs = null;
    this.fired = false;
    this.progress = 0;
  }
}
