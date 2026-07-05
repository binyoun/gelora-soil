import * as THREE from 'three';
import { extractFlowerDNA } from './capture/dna';
import { Camera } from './capture/camera';
import { initSegmenter, segmentFrame } from './capture/segment';
import { ShutterController } from './capture/shutter';
import { buildHandState } from './hand/gestures';
import { initHandLandmarker, detectHands } from './hand/landmarker';
import { PalmStabilityTracker, type RawLandmark } from './hand/palm';
import { GrowthEngine } from './growth/engine';
import { Petals } from './growth/petals';
import { Roots } from './growth/roots';
import { Stem } from './growth/stem';
import { ARScene } from './render/scene';
import { StageMachine } from './stages';
import type { FlowerDNA, HandState } from './types';
import { DebugOverlay, FpsMonitor, isDebugEnabled } from './ui/debug';
import { PromptUI, promptForStage } from './ui/prompts';

const videoEl = document.getElementById('camera-feed') as HTMLVideoElement;
const sceneCanvas = document.getElementById('scene') as HTMLCanvasElement;
const debugCanvas = document.getElementById('debug-overlay') as HTMLCanvasElement;
const permissionGate = document.getElementById('permission-gate')!;
const permissionButton = document.getElementById('permission-request') as HTMLButtonElement;
const stageCaptureSection = document.getElementById('stage-capture')!;
const stageGrowSection = document.getElementById('stage-grow')!;
const cameraToggleButton = document.getElementById('camera-toggle') as HTMLButtonElement;
const shutterFallbackButton = document.getElementById('shutter-fallback') as HTMLButtonElement;
const restartButton = document.getElementById('restart-button') as HTMLButtonElement;
const promptEl = document.getElementById('prompt')!;

const EMPTY_HAND: HandState = {
  present: false,
  palmOrigin: { x: 0, y: 0, z: 0 },
  palmNormal: { x: 0, y: 0, z: 1 },
  scale: 0,
  openness: 0,
  stability: 0,
  tilt: 0,
  secondHandTip: null,
};

const camera = new Camera(videoEl);
const arScene = new ARScene(sceneCanvas);
const stageMachine = new StageMachine();
const shutter = new ShutterController();
const stabilityTracker = new PalmStabilityTracker();
const promptUI = new PromptUI(promptEl);
const fpsMonitor = new FpsMonitor();
const debugOverlay = isDebugEnabled() ? new DebugOverlay(debugCanvas) : null;

let growthEngine: GrowthEngine | null = null;
let currentDna: FlowerDNA | null = null;
let stem: Stem | null = null;
let roots: Roots | null = null;
let petals: Petals | null = null;
let captureTexture: THREE.CanvasTexture | null = null;

let capturing = false;
let manualShutterTrigger = false;
let restartRequested = false;
let enteredEndedAtMs: number | null = null;
let pixelRatioHalved = false;
let prevStage = stageMachine.stage;
let lastFrameMs = performance.now();

async function begin(): Promise<void> {
  permissionButton.disabled = true;
  // Make the capture stage active (still hidden behind the opaque permission
  // gate) before starting the camera, so video.play() is never called while an
  // ancestor is display:none, which iOS Safari can reject.
  stageCaptureSection.classList.add('active');
  try {
    await camera.start('environment');
  } catch (err) {
    console.error(err);
    permissionButton.disabled = false;
    promptUI.set('camera access denied. reload to try again');
    return;
  }

  await Promise.all([initHandLandmarker(), initSegmenter()]);

  arScene.attachVideo(videoEl, camera.currentFacing === 'user');
  permissionGate.classList.add('hidden');

  requestAnimationFrame(loop);
}

permissionButton.addEventListener('click', () => {
  begin().catch((err) => console.error(err));
});

cameraToggleButton.addEventListener('click', () => {
  camera
    .toggleFacing()
    .then(() => arScene.updateVideoAspect(videoEl, camera.currentFacing === 'user'))
    .catch((err) => console.error(err));
});

shutterFallbackButton.addEventListener('click', () => {
  manualShutterTrigger = true;
});

restartButton.addEventListener('click', () => {
  restartRequested = true;
});

function freezeFrame(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  canvas.getContext('2d')!.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function disposeGrowthVisuals(): void {
  if (stem) {
    arScene.overlayGroup.remove(stem.mesh);
    stem.dispose();
  }
  if (roots) {
    arScene.overlayGroup.remove(roots.group);
    roots.dispose();
  }
  if (petals) {
    arScene.overlayGroup.remove(petals.instancedMesh, petals.particles);
    petals.dispose();
  }
  stem = null;
  roots = null;
  petals = null;
}

async function runCapturePipeline(pinchPoint: { x: number; y: number }): Promise<void> {
  capturing = true;

  const frame = freezeFrame();
  const matted = await segmentFrame(frame, pinchPoint);
  const dna = extractFlowerDNA(matted);

  currentDna = dna;
  captureTexture?.dispose();
  captureTexture = new THREE.CanvasTexture(matted);
  captureTexture.colorSpace = THREE.SRGBColorSpace;

  disposeGrowthVisuals();
  growthEngine = new GrowthEngine(dna);
  stem = new Stem(dna);
  roots = new Roots();
  petals = new Petals(dna);
  petals.setTexture(captureTexture);
  arScene.overlayGroup.add(stem.mesh, roots.group, petals.instancedMesh, petals.particles);

  await wait(1500);

  capturing = false;
  stageMachine.update({
    shutterFired: true,
    hand: EMPTY_HAND,
    maturity: 0,
    pouredOut: false,
    timestampMs: performance.now(),
    restartRequested: false,
  });
  stageCaptureSection.classList.remove('active');
  stageGrowSection.classList.add('active');
}

function resetToCapture(): void {
  disposeGrowthVisuals();
  captureTexture?.dispose();
  captureTexture = null;
  currentDna = null;
  growthEngine = null;
  enteredEndedAtMs = null;
  shutter.reset();
  stabilityTracker.reset();
  stageGrowSection.classList.remove('active');
  stageCaptureSection.classList.add('active');
}

function consumeManualTrigger(): boolean {
  if (manualShutterTrigger) {
    manualShutterTrigger = false;
    return true;
  }
  return false;
}

function loop(nowMs: number): void {
  const dtSeconds = Math.min(0.1, (nowMs - lastFrameMs) / 1000);
  lastFrameMs = nowMs;
  fpsMonitor.tick(nowMs);

  const result = videoEl.readyState >= 2 ? detectHands(videoEl, nowMs) : null;
  const primaryRaw: RawLandmark[] | null = result?.landmarks?.[0] ?? null;
  const secondaryRaw: RawLandmark[] | null = result?.landmarks?.[1] ?? null;

  let stability = 0;
  if (primaryRaw) {
    const wristKnuckle = primaryRaw[9]!;
    stability = stabilityTracker.update({ x: wristKnuckle.x, y: wristKnuckle.y, z: wristKnuckle.z }, nowMs);
  } else {
    stabilityTracker.reset();
  }

  const hand = buildHandState(primaryRaw, secondaryRaw, stability);
  const mirror = camera.currentFacing === 'user';

  if (stageMachine.stage === 'CAPTURE' && !capturing) {
    const pinchFired = shutter.update(primaryRaw, nowMs) || consumeManualTrigger();
    if (pinchFired) {
      const pinchPoint = primaryRaw
        ? { x: (primaryRaw[4]!.x + primaryRaw[8]!.x) / 2, y: (primaryRaw[4]!.y + primaryRaw[8]!.y) / 2 }
        : { x: 0.5, y: 0.5 };
      runCapturePipeline(pinchPoint).catch((err) => console.error(err));
    }
  }

  let maturity = 0;
  let pouredOut = false;
  if (growthEngine) {
    if (stageMachine.growthGateOpen) {
      growthEngine.tick(hand, dtSeconds);
    }
    const state = growthEngine.getState();
    maturity = state.maturity;
    pouredOut = growthEngine.pouredOut;

    const map = arScene.getMapping();
    roots?.update(primaryRaw, map, maturity);
    stem?.update(hand, map, maturity, state.wiltAmount, nowMs / 1000);
    if (currentDna) petals?.update(currentDna, state, hand, map, nowMs / 1000, dtSeconds);
  }

  const stage = stageMachine.update({
    shutterFired: false,
    hand,
    maturity,
    pouredOut,
    timestampMs: nowMs,
    restartRequested,
  });
  restartRequested = false;

  if (stage !== prevStage) {
    if (stage === 'ENDED') enteredEndedAtMs = nowMs;
    if (stage === 'CAPTURE' && prevStage === 'ENDED') resetToCapture();
    prevStage = stage;
  }

  if (stage === 'ENDED' && enteredEndedAtMs !== null && nowMs - enteredEndedAtMs > 1000) {
    if (stem) stem.mesh.visible = false;
    if (roots) roots.group.visible = false;
    if (petals) petals.instancedMesh.visible = false;
  }

  promptUI.set(promptForStage(stage, { handPresent: hand.present, capturing }));

  if (debugOverlay) {
    debugOverlay.resize(window.innerWidth, window.innerHeight);
    debugOverlay.draw({
      fps: fpsMonitor.fps,
      stage,
      hand: hand.present ? hand : null,
      landmarks: primaryRaw,
      dna: currentDna,
      mirror,
    });
  }

  if (fpsMonitor.checkSustainedLowFps(nowMs) && !pixelRatioHalved) {
    pixelRatioHalved = true;
    arScene.setPixelRatio(Math.max(0.5, window.devicePixelRatio / 2));
  }

  arScene.render();
  requestAnimationFrame(loop);
}
