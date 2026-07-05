import * as THREE from 'three';
import { extractFlowerDNA } from './capture/dna';
import { Camera } from './capture/camera';
import { initSegmenter, segmentFrame } from './capture/segment';
import { buildHandState } from './hand/gestures';
import { initHandLandmarker, detectHands } from './hand/landmarker';
import { PalmStabilityTracker, type RawLandmark } from './hand/palm';
import { GrowthEngine } from './growth/engine';
import { Flower } from './growth/flower';
import { Roots } from './growth/roots';
import { ARScene } from './render/scene';
import { landmarkSpan, landmarkToScreen, landmarkToWorld } from './render/anchor';
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
const cameraToggleButton = document.getElementById('camera-toggle') as HTMLButtonElement;
const shutterFallbackButton = document.getElementById('shutter-fallback') as HTMLButtonElement;
const promptEl = document.getElementById('prompt')!;
const captureRing = document.getElementById('capture-ring') as unknown as SVGSVGElement;
const captureRingProg = captureRing.querySelector('.prog') as SVGCircleElement;
const palmRing = document.getElementById('palm-ring') as unknown as SVGSVGElement;
const palmRingProg = palmRing.querySelector('.prog') as SVGCircleElement;

const CAPTURE_RING_C = 2 * Math.PI * 50;
const PALM_RING_C = 2 * Math.PI * 44;
captureRingProg.style.strokeDasharray = `${CAPTURE_RING_C}`;
palmRingProg.style.strokeDasharray = `${PALM_RING_C}`;

function setRingProgress(el: SVGCircleElement, circumference: number, progress: number): void {
  el.style.strokeDashoffset = `${circumference * (1 - Math.max(0, Math.min(1, progress)))}`;
}

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

const AUTO_CAPTURE_SECONDS = 3; // selfie self-timer

const camera = new Camera(videoEl);
const arScene = new ARScene(sceneCanvas);
const stageMachine = new StageMachine();
const stabilityTracker = new PalmStabilityTracker();
const promptUI = new PromptUI(promptEl);
const fpsMonitor = new FpsMonitor();
const debugOverlay = isDebugEnabled() ? new DebugOverlay(debugCanvas) : null;

let growthEngine: GrowthEngine | null = null;
let currentDna: FlowerDNA | null = null;
let roots: Roots | null = null;
let flower: Flower | null = null;
let captureTexture: THREE.CanvasTexture | null = null;

let capturing = false;
let manualShutterTrigger = false;
let restartRequested = false;
let enteredEndedAtMs: number | null = null;
let revealStartMs: number | null = null;
let captureCountdownStartMs: number | null = null;
const originWorld = new THREE.Vector3();
let handScale = 0.15;
let pixelRatioHalved = false;
let prevStage = stageMachine.stage;
let lastFrameMs = performance.now();

async function begin(): Promise<void> {
  permissionButton.disabled = true;
  // Show the capture controls (still hidden behind the opaque permission gate)
  // so they are ready the moment the gate lifts.
  stageCaptureSection.classList.add('active');
  try {
    await camera.start('user'); // front camera: the selfie becomes the flower (narcissus)
  } catch (err) {
    console.error(err);
    permissionButton.disabled = false;
    promptUI.set('camera access denied. reload to try again');
    return;
  }

  await Promise.all([initHandLandmarker(), initSegmenter()]);

  applyVideoMetrics();
  permissionGate.classList.add('hidden');

  requestAnimationFrame(loop);
}

/** Sync the DOM video mirror class and the scene's anchor metrics to the current camera. */
function applyVideoMetrics(): void {
  const mirror = camera.currentFacing === 'user';
  videoEl.classList.toggle('mirrored', mirror);
  const aspect = videoEl.videoWidth && videoEl.videoHeight ? videoEl.videoWidth / videoEl.videoHeight : 16 / 9;
  arScene.setVideoMetrics(aspect, mirror);
}

permissionButton.addEventListener('click', () => {
  begin().catch((err) => console.error(err));
});

videoEl.addEventListener('loadedmetadata', applyVideoMetrics);

cameraToggleButton.addEventListener('click', () => {
  camera
    .toggleFacing()
    .then(applyVideoMetrics)
    .catch((err) => console.error(err));
});

shutterFallbackButton.addEventListener('click', () => {
  manualShutterTrigger = true;
});

// Tap anywhere to begin again once the being has ended (no button, just the prompt).
window.addEventListener('pointerdown', () => {
  if (stageMachine.stage === 'ENDED') restartRequested = true;
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
  if (roots) {
    arScene.overlayGroup.remove(roots.group);
    roots.dispose();
  }
  if (flower) {
    arScene.overlayGroup.remove(flower.group, flower.particles);
    flower.dispose();
  }
  roots = null;
  flower = null;
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
  roots = new Roots();
  flower = new Flower(dna, captureTexture);
  arScene.overlayGroup.add(roots.group, flower.group, flower.particles);

  arScene.beginReveal(captureTexture, matted.width / matted.height);
  revealStartMs = performance.now();

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
  // Stage-section visibility is driven every frame by updateStageUI in the loop.
}

function resetToCapture(): void {
  disposeGrowthVisuals();
  captureTexture?.dispose();
  captureTexture = null;
  currentDna = null;
  growthEngine = null;
  enteredEndedAtMs = null;
  revealStartMs = null;
  captureCountdownStartMs = null;
  arScene.setRevealOpacity(0);
  stabilityTracker.reset();
}

/** Stage sections hold only stage-specific controls; the render layer is persistent.
    Capture controls show only in CAPTURE (and not during the post-shutter reveal);
    the restart affordance shows only in ENDED. */
function updateStageUI(stage: string, isCapturing: boolean): void {
  stageCaptureSection.classList.toggle('active', stage === 'CAPTURE' && !isCapturing);
}

/** Countdown ring during the selfie self-timer; palm-position ring during the open-palm offer. */
function updateRings(stage: string, primaryRaw: RawLandmark[] | null, nowMs: number): void {
  const counting = stage === 'CAPTURE' && !capturing && captureCountdownStartMs !== null;
  const progress = counting ? Math.min(1, (nowMs - captureCountdownStartMs!) / 1000 / AUTO_CAPTURE_SECONDS) : 0;
  captureRing.style.opacity = counting ? '1' : '0';
  setRingProgress(captureRingProg, CAPTURE_RING_C, progress);

  if (stage === 'SOWING' && primaryRaw) {
    const s = landmarkToScreen(primaryRaw[9]!, arScene.anchorContext());
    palmRing.style.display = 'block';
    palmRing.style.left = `${s.x * window.innerWidth}px`;
    palmRing.style.top = `${s.y * window.innerHeight}px`;
    setRingProgress(palmRingProg, PALM_RING_C, stageMachine.sowingProgress);
  } else {
    palmRing.style.display = 'none';
  }
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
    // selfie self-timer: auto-capture after the countdown, or immediately on tap
    if (captureCountdownStartMs === null) captureCountdownStartMs = nowMs;
    const elapsed = (nowMs - captureCountdownStartMs) / 1000;
    const timedOut = elapsed >= AUTO_CAPTURE_SECONDS;
    if (timedOut || consumeManualTrigger()) {
      runCapturePipeline({ x: 0.5, y: 0.5 }).catch((err) => console.error(err)); // selfie is centered
    }
  } else if (stageMachine.stage !== 'CAPTURE') {
    captureCountdownStartMs = null;
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

    const ctx = arScene.anchorContext();
    if (primaryRaw) {
      landmarkToWorld(primaryRaw[9]!, ctx, originWorld);
      handScale = Math.max(0.03, landmarkSpan(primaryRaw[0]!, primaryRaw[9]!, ctx));
    }

    const t = nowMs / 1000;
    roots?.update(primaryRaw, ctx, maturity);
    if (currentDna) flower?.update(currentDna, state, originWorld, handScale, hand.present, t, dtSeconds);
  }

  if (revealStartMs !== null) {
    const revealAge = nowMs - revealStartMs;
    // hold for 1.2s, then fade out by 2.5s, and hand off early once the being has taken root
    let opacity = revealAge < 1200 ? 1 : 1 - (revealAge - 1200) / 1300;
    if (maturity > 0.1) opacity = Math.min(opacity, 1 - maturity / 0.1);
    opacity = Math.max(0, Math.min(1, opacity));
    arScene.setRevealOpacity(opacity);
    if (opacity <= 0.001) revealStartMs = null;
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

  updateStageUI(stage, capturing);
  updateRings(stage, primaryRaw, nowMs);

  if (stage === 'ENDED' && enteredEndedAtMs !== null && nowMs - enteredEndedAtMs > 1200) {
    if (flower) flower.group.visible = false;
    if (roots) roots.group.visible = false;
  }

  if (stage === 'CAPTURE' && !capturing && captureCountdownStartMs !== null) {
    // "get closer" first, then a 2..1 countdown before the selfie fires
    const remaining = AUTO_CAPTURE_SECONDS - (nowMs - captureCountdownStartMs) / 1000;
    promptUI.set(remaining > 2 ? 'get closer' : String(Math.max(1, Math.ceil(remaining))));
  } else {
    promptUI.set(promptForStage(stage, { handPresent: hand.present, capturing }));
  }

  if (debugOverlay) {
    debugOverlay.resize(window.innerWidth, window.innerHeight);
    debugOverlay.draw({
      fps: fpsMonitor.fps,
      stage,
      hand: hand.present ? hand : null,
      landmarks: primaryRaw,
      dna: currentDna,
      maturity: growthEngine?.getState().maturity ?? 0,
      wilt: growthEngine?.getState().wiltAmount ?? 0,
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
