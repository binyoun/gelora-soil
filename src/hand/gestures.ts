import type { HandState, Vec3 } from '../types';
import { distance } from '../util/vec3';
import { palmNormal, palmOrigin, palmScale, type RawLandmark } from './palm';

const CAMERA_AXIS: Vec3 = { x: 0, y: 0, z: -1 };

const FINGERS: Array<readonly [tip: number, mcp: number]> = [
  [8, 5], // index
  [12, 9], // middle
  [16, 13], // ring
  [20, 17], // pinky
];

const CURL_RATIO_MIN = 0.8; // fist: fingertip barely farther from wrist than its knuckle
const CURL_RATIO_MAX = 2.0; // fully open

/** Mean fingertip extension, relative to wrist, across the four fingers. 0 fist .. 1 open. */
export function computeOpenness(landmarks: RawLandmark[]): number {
  const wrist = landmarks[0]!;
  let sum = 0;
  for (const [tip, mcp] of FINGERS) {
    const tipDist = distance(landmarks[tip]!, wrist);
    const mcpDist = distance(landmarks[mcp]!, wrist);
    sum += mcpDist > 1e-6 ? tipDist / mcpDist : 0;
  }
  const meanRatio = sum / FINGERS.length;
  const normalized = (meanRatio - CURL_RATIO_MIN) / (CURL_RATIO_MAX - CURL_RATIO_MIN);
  return Math.max(0, Math.min(1, normalized));
}

/** Pinch distance between thumb tip (4) and index tip (8), in normalized landmark units. */
export function pinchDistance(landmarks: RawLandmark[]): number {
  return distance(landmarks[4]!, landmarks[8]!);
}

/**
 * How far the palm has tilted away from facing the camera, 0 (flat toward
 * camera) to 90 (edge-on). The palm normal's sign is ambiguous (it flips with
 * hand chirality and landmark order), so a flat palm can read as ~0 or ~180;
 * we fold to 0..90 so a flat palm is always ~0 and pour never triggers falsely.
 */
export function computeTilt(landmarks: RawLandmark[]): number {
  const normal = palmNormal(landmarks);
  const dotV = normal.x * CAMERA_AXIS.x + normal.y * CAMERA_AXIS.y + normal.z * CAMERA_AXIS.z;
  const clamped = Math.max(-1, Math.min(1, dotV));
  const angle = (Math.acos(clamped) * 180) / Math.PI; // 0..180
  return angle > 90 ? 180 - angle : angle; // fold to 0..90, orientation-agnostic
}

export function secondHandTip(landmarks: RawLandmark[] | null): Vec3 | null {
  if (!landmarks) return null;
  const tip = landmarks[8]!;
  return { x: tip.x, y: tip.y, z: tip.z };
}

const EMPTY_STATE: HandState = {
  present: false,
  palmOrigin: { x: 0, y: 0, z: 0 },
  palmNormal: { x: 0, y: 0, z: 1 },
  scale: 0,
  openness: 0,
  stability: 0,
  tilt: 0,
  secondHandTip: null,
};

export function buildHandState(
  primary: RawLandmark[] | null,
  secondary: RawLandmark[] | null,
  stability: number,
): HandState {
  if (!primary) return EMPTY_STATE;

  return {
    present: true,
    palmOrigin: palmOrigin(primary),
    palmNormal: palmNormal(primary),
    scale: palmScale(primary),
    openness: computeOpenness(primary),
    stability,
    tilt: computeTilt(primary),
    secondHandTip: secondHandTip(secondary),
  };
}
