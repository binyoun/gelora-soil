import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';

// FaceLandmarker for the grow-from-the-mouth mode. Self-hosted model + wasm
// (no CDN), mirroring the HandLandmarker setup. One face, VIDEO mode; we read
// mouth geometry from the 468-point mesh (no blendshape classifiers, in keeping
// with the piece's continuous-geometry grammar).

const WASM_BASE = `${import.meta.env.BASE_URL}vendor/mediapipe-wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/face_landmarker.task`;

let landmarker: FaceLandmarker | null = null;

export async function initFaceLandmarker(): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  return landmarker;
}

export function detectFace(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult | null {
  if (!landmarker) return null;
  return landmarker.detectForVideo(video, timestampMs);
}

export function disposeFaceLandmarker(): void {
  landmarker?.close();
  landmarker = null;
}
