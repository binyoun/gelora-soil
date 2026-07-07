import type { HandState, Vec3 } from '../types';
import { distance } from '../util/vec3';
import type { RawLandmark } from '../hand/palm';

// Mouth geometry for the grow-from-the-mouth mode. From the FaceLandmarker mesh
// we derive a HandState the growth engine already understands: the mouth center
// is the origin the flower roots to, mouth openness maps to `openness` (so a
// closed mouth wilts the bloom and an open mouth lets it open), head stillness
// to `stability`, face span to `scale`, head roll to `tilt` (tip your head to
// pour). All continuous geometry, no classifiers.

const UPPER_INNER_LIP = 13;
const LOWER_INNER_LIP = 14;
const FACE_TOP = 10; // between the brows / upper forehead
const CHIN = 152;
const EYE_OUTER_L = 33;
const EYE_OUTER_R = 263;

// Inner-lip gap as a fraction of face height: closed near OPEN_MIN, wide at OPEN_MAX.
const OPEN_MIN = 0.03;
const OPEN_MAX = 0.13;

export function mouthCenter(face: RawLandmark[]): Vec3 {
  const a = face[UPPER_INNER_LIP]!;
  const b = face[LOWER_INNER_LIP]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function faceSpan(face: RawLandmark[]): number {
  return distance(face[EYE_OUTER_L]!, face[EYE_OUTER_R]!);
}

function mouthOpenness(face: RawLandmark[]): number {
  const gap = distance(face[UPPER_INNER_LIP]!, face[LOWER_INNER_LIP]!);
  const height = distance(face[FACE_TOP]!, face[CHIN]!);
  const ratio = height > 1e-6 ? gap / height : 0;
  return Math.max(0, Math.min(1, (ratio - OPEN_MIN) / (OPEN_MAX - OPEN_MIN)));
}

/** Head roll from the eye line, folded to 0..90 so pour never triggers from a level head. */
function headTilt(face: RawLandmark[]): number {
  const l = face[EYE_OUTER_L]!;
  const r = face[EYE_OUTER_R]!;
  const roll = (Math.atan2(r.y - l.y, r.x - l.x) * 180) / Math.PI;
  const a = Math.abs(roll);
  return a > 90 ? 180 - a : a;
}

const EMPTY: HandState = {
  present: false,
  palmOrigin: { x: 0, y: 0, z: 0 },
  palmNormal: { x: 0, y: 0, z: 1 },
  scale: 0,
  openness: 0,
  stability: 0,
  tilt: 0,
  secondHandTip: null,
};

export function buildMouthHandState(face: RawLandmark[] | null, stability: number): HandState {
  if (!face) return EMPTY;
  return {
    present: true,
    palmOrigin: mouthCenter(face),
    palmNormal: { x: 0, y: 0, z: 1 },
    scale: faceSpan(face),
    openness: mouthOpenness(face),
    stability,
    tilt: headTilt(face),
    secondHandTip: null,
  };
}
