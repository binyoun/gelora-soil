import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_BASE = `${import.meta.env.BASE_URL}vendor/mediapipe-wasm`;
const MODEL_PATH = `${import.meta.env.BASE_URL}models/hand_landmarker.task`;

let landmarker: HandLandmarker | null = null;

export async function initHandLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
  });
  return landmarker;
}

export function detectHands(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult | null {
  if (!landmarker) return null;
  return landmarker.detectForVideo(video, timestampMs);
}

export function disposeHandLandmarker(): void {
  landmarker?.close();
  landmarker = null;
}
