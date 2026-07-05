import type { Vec3 } from '../types';
import { cross, distance, normalize, sub } from '../util/vec3';

export interface RawLandmark {
  x: number;
  y: number;
  z: number;
}

const STABILITY_TIME_CONSTANT_S = 0.5;
const STABILITY_VELOCITY_CEILING = 0.6; // normalized units/sec at which stability bottoms out at 0

export function palmOrigin(landmarks: RawLandmark[]): Vec3 {
  const p = landmarks[9]!;
  return { x: p.x, y: p.y, z: p.z };
}

export function palmNormal(landmarks: RawLandmark[]): Vec3 {
  const wrist = landmarks[0]!;
  const indexMcp = landmarks[5]!;
  const pinkyMcp = landmarks[17]!;
  const v1 = sub(indexMcp, wrist);
  const v2 = sub(pinkyMcp, wrist);
  return normalize(cross(v1, v2));
}

export function palmScale(landmarks: RawLandmark[]): number {
  return distance(landmarks[0]!, landmarks[9]!);
}

/** Tracks palm-origin velocity over time to derive a 0..1 stillness score. Stillness is care. */
export class PalmStabilityTracker {
  private lastOrigin: Vec3 | null = null;
  private lastTimeMs: number | null = null;
  private velocityEma = 0;

  update(origin: Vec3, timestampMs: number): number {
    if (this.lastOrigin === null || this.lastTimeMs === null) {
      this.lastOrigin = origin;
      this.lastTimeMs = timestampMs;
      return 0;
    }

    const dtMs = timestampMs - this.lastTimeMs;
    if (dtMs <= 0) return this.stabilityFromVelocity();

    const dtS = dtMs / 1000;
    const instantVelocity = distance(origin, this.lastOrigin) / dtS;
    const alpha = 1 - Math.exp(-dtS / STABILITY_TIME_CONSTANT_S);
    this.velocityEma = this.velocityEma + alpha * (instantVelocity - this.velocityEma);

    this.lastOrigin = origin;
    this.lastTimeMs = timestampMs;

    return this.stabilityFromVelocity();
  }

  reset(): void {
    this.lastOrigin = null;
    this.lastTimeMs = null;
    this.velocityEma = 0;
  }

  private stabilityFromVelocity(): number {
    const s = 1 - this.velocityEma / STABILITY_VELOCITY_CEILING;
    return Math.max(0, Math.min(1, s));
  }
}
