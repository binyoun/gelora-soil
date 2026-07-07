import * as THREE from 'three';
import { extractFlowerDNA } from './capture/dna';
import { Camera } from './capture/camera';
import { initSegmenter, segmentFrame } from './capture/segment';
import { buildHandState } from './hand/gestures';
import { initHandLandmarker, detectHands } from './hand/landmarker';
import { PalmStabilityTracker, type RawLandmark } from './hand/palm';
import { initFaceLandmarker, detectFace } from './face/landmarker';
import { buildMouthHandState, mouthCenter } from './face/mouth';
import { GrowthEngine } from './growth/engine';
import { FlowerHeart } from './growth/flowerHeart';
import { PulseSensor } from './sensors/pulse';
import { AltarSound } from './sound/altarSound';
import { Flower } from './growth/flower';
import { TEMPLATES, type FlowerTemplate } from './growth/flowerTemplates';
import { Roots } from './growth/roots';
import { ARScene } from './render/scene';
import { landmarkSpan, landmarkToScreen, landmarkToWorld } from './render/anchor';
import { StageMachine } from './stages';
import type { FlowerDNA, HandState, Stage } from './types';
import { DebugOverlay, FpsMonitor, isDebugEnabled } from './ui/debug';
import { PromptUI, promptForStage } from './ui/prompts';

const appEl = document.getElementById('app')!;
const videoEl = document.getElementById('camera-feed') as HTMLVideoElement;
const sceneCanvas = document.getElementById('scene') as HTMLCanvasElement;
const debugCanvas = document.getElementById('debug-overlay') as HTMLCanvasElement;
const landingEl = document.getElementById('landing')!;
const chevLeftBtn = document.getElementById('chev-left') as HTMLButtonElement;
const chevRightBtn = document.getElementById('chev-right') as HTMLButtonElement;
const backButton = document.getElementById('back') as HTMLButtonElement;
const flowerNameEl = document.getElementById('flower-name')!;
const flowerTagEl = document.getElementById('flower-tag')!;
const ctxEl = document.getElementById('context')!;
const ctxNameEl = document.getElementById('ctx-name')!;
const ctxStoryEl = document.getElementById('ctx-story')!;
const stageCaptureSection = document.getElementById('stage-capture')!;
const cameraToggleButton = document.getElementById('camera-toggle') as HTMLButtonElement;
const shutterFallbackButton = document.getElementById('shutter-fallback') as HTMLButtonElement;
const promptEl = document.getElementById('prompt')!;
const growToggleEl = document.getElementById('grow-toggle')!;
const pulseConnectButton = document.getElementById('pulse-connect') as HTMLButtonElement;
const pulseReadEl = document.getElementById('pulse-read')!;
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

// Pulse-ground altar (Øryn 맥): ?altar=1 runs the fixed-camera installation mode.
// A physical pulse sensor drives growth; the camera is a fixed rig, not held, so
// it is not mirrored. Without a board the simulated pulse keeps it running.
const ALTAR_MODE = new URLSearchParams(window.location.search).get('altar') === '1';
const pulse = new PulseSensor();
const altarSound = new AltarSound();
altarSound.setEnabled(ALTAR_MODE);
const flowerHeart = new FlowerHeart(); // the flower's own drifting pulse, for the dome haptic

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
let selectedTemplate: FlowerTemplate = TEMPLATES[0]!; // chosen on the landing page
const originWorld = new THREE.Vector3();
let handScale = 0.15;
let pixelRatioHalved = false;
let prevStage = stageMachine.stage;
let lastFrameMs = performance.now();

let mode: 'landing' | 'ar' = 'landing';
let growMode: 'palm' | 'mouth' = 'palm'; // landing choice: grow from the hand, or from the open mouth
let cameraReady = false;
let handReady = false;
let faceReady = false;
let segmenterReady = false;
let starting = false;
let switchingCamera = false; // altar: guards the face<->hand camera swap
let flowerIndex = 0;
let preview: Flower | null = null;
const previewDna = makeDummyDna();
const previewGrowth = new GrowthEngine(previewDna);
previewGrowth.getState().maturity = 0.86;
const previewOrigin = new THREE.Vector3(-0.03, -0.3, -1.5);
const PREVIEW_HAND_SCALE = 0.14;
let placeholderTex: THREE.CanvasTexture | null = null;

async function begin(): Promise<void> {
  if (starting || mode !== 'landing') return;
  starting = true;
  // This tap is the user gesture Web Audio needs; start the altar sound here.
  if (ALTAR_MODE) altarSound.resume().catch((err) => console.error(err));
  landingEl.classList.add('loading');
  try {
    // Front camera: the visitor's portrait becomes the flower. Only the tracker
    // for the chosen grow mode is loaded (hand landmarker, or face landmarker for
    // the mouth), each once. The segmenter mattes the selfie for both modes.
    if (!cameraReady) {
      await camera.start('user');
      cameraReady = true;
    }
    const jobs: Promise<unknown>[] = [];
    if (!segmenterReady) jobs.push(initSegmenter().then(() => { segmenterReady = true; }));
    // Both modes use the hand landmarker: palm mode to root the flower, mouth mode
    // for the mediated-touch glitch (a hand brought to the bloom erupts it).
    if (!handReady) jobs.push(initHandLandmarker().then(() => { handReady = true; }));
    if (growMode === 'mouth' && !faceReady) jobs.push(initFaceLandmarker().then(() => { faceReady = true; }));
    await Promise.all(jobs);
  } catch (err) {
    console.error(err);
    landingEl.classList.remove('loading');
    starting = false;
    flowerNameEl.textContent = 'camera access denied';
    return;
  }
  applyVideoMetrics();
  landingEl.classList.remove('loading');
  starting = false;
  enterAR();
}

function enterAR(): void {
  mode = 'ar';
  appEl.classList.remove('mode-landing');
  appEl.classList.add('mode-ar');
  landingEl.classList.add('hidden');
  disposePreview();
  resetToCapture();
  stageMachine.reset();
  prevStage = stageMachine.stage;
}

function goBack(): void {
  mode = 'landing';
  appEl.classList.remove('mode-ar');
  appEl.classList.add('mode-landing');
  landingEl.classList.remove('hidden');
  resetToCapture();
  stageMachine.reset();
  prevStage = stageMachine.stage;
  ctxEl.classList.remove('show');
  buildPreview();
}

/** Sync the DOM video mirror class and the scene's anchor metrics to the current camera. */
function applyVideoMetrics(): void {
  const mirror = camera.currentFacing === 'user';
  videoEl.classList.toggle('mirrored', mirror);
  const aspect = videoEl.videoWidth && videoEl.videoHeight ? videoEl.videoWidth / videoEl.videoHeight : 16 / 9;
  arScene.setVideoMetrics(aspect, mirror);
}

/** Altar: switch the live camera between the face (front) and hand (fixed) rigs.
    Idempotent and guarded so it is safe to call every frame. */
async function ensureFacing(facing: 'user' | 'environment'): Promise<void> {
  if (camera.currentFacing === facing || switchingCamera) return;
  switchingCamera = true;
  try {
    await camera.start(facing);
    applyVideoMetrics();
  } catch (err) {
    console.error(err);
  } finally {
    switchingCamera = false;
  }
}

backButton.addEventListener('click', () => {
  if (mode === 'ar') goBack();
});

// Pulse-ground altar: reveal the connect chip and wire it. Web Serial requires a
// user gesture, so connection happens on this tap. Unsupported browsers (iOS
// Safari) keep the simulated pulse; the button just reports it.
if (ALTAR_MODE) {
  appEl.classList.add('altar');
  if (!pulse.supported) pulseConnectButton.textContent = 'pulse: simulated';
  pulseConnectButton.addEventListener('click', () => {
    if (!pulse.supported) return;
    pulseConnectButton.textContent = 'connecting';
    pulse
      .connect()
      .then((ok) => {
        pulseConnectButton.textContent = ok ? 'pulse: live' : 'connect pulse';
      })
      .catch((err) => {
        console.error(err);
        pulseConnectButton.textContent = 'connect pulse';
      });
  });
}

// Landing: swipe left/right (or tap the chevrons) to change flower; tap to begin.
function changeFlower(delta: number): void {
  flowerIndex = (flowerIndex + delta + TEMPLATES.length) % TEMPLATES.length;
  selectFlower(flowerIndex);
}
chevLeftBtn.addEventListener('click', (e) => { e.stopPropagation(); changeFlower(-1); });
chevRightBtn.addEventListener('click', (e) => { e.stopPropagation(); changeFlower(1); });

// Landing: choose to grow from the palm or from the open mouth.
function setGrowMode(m: 'palm' | 'mouth'): void {
  growMode = m;
  growToggleEl.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', (b as HTMLElement).dataset.mode === m);
  });
}
growToggleEl.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = (btn as HTMLElement).dataset.mode as 'palm' | 'mouth' | undefined;
    if (m) setGrowMode(m);
  });
});

let touchStartX = 0;
let touchStartY = 0;
let touchStartT = 0;
window.addEventListener('pointerdown', (e) => {
  if (mode !== 'landing') return;
  touchStartX = e.clientX;
  touchStartY = e.clientY;
  touchStartT = performance.now();
});
window.addEventListener('pointerup', (e) => {
  if (mode !== 'landing' || starting) return;
  const dx = e.clientX - touchStartX;
  const dy = e.clientY - touchStartY;
  const dt = performance.now() - touchStartT;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
    changeFlower(dx < 0 ? 1 : -1); // swipe left -> next
  } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 500) {
    if (!(e.target as HTMLElement).closest('.chev, #grow-toggle')) begin().catch((err) => console.error(err));
  }
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

// Tap the AR view to begin again once the being has ended.
sceneCanvas.addEventListener('pointerdown', () => {
  if (mode === 'ar' && stageMachine.stage === 'ENDED') restartRequested = true;
});

// Swaps the rotating preview to flower i and updates the name/tag.
function selectFlower(i: number): void {
  flowerIndex = i;
  selectedTemplate = TEMPLATES[i]!;
  flowerNameEl.textContent = selectedTemplate.name;
  flowerTagEl.textContent = tagFor(selectedTemplate.id);
  buildPreview();
}

function tagFor(id: string): string {
  switch (id) {
    case 'tulip': return 'extinct';
    case 'chrysanthemum': return 'the dead';
    case 'kadupul': return 'one night only';
    case 'ghost': return 'endangered';
    case 'franklinia': return 'lost from the wild';
    case 'kokio': return 'critically rare';
    case 'rafflesia': return 'ephemeral';
    case 'jade': return 'endangered';
    case 'cosmos': return 'a single clone';
    case 'middlemist': return 'two plants left';
    default: return '';
  }
}

function makeDummyDna(): FlowerDNA {
  return { seed: 7, hueCenter: 42, hueSpread: 0.2, saturation: 0.25, luminance: 0.7, edgeComplexity: 0.5, aspect: 1, petalCount: 11, textureRegions: [] };
}

/** A neutral pale texture for the landing preview (no selfie yet). */
function placeholderTexture(): THREE.CanvasTexture {
  if (placeholderTex) return placeholderTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, '#f3ecdd');
  g.addColorStop(0.6, '#cbb9a6');
  g.addColorStop(1, '#6d6357');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.49, 0, Math.PI * 2);
  ctx.fill();
  placeholderTex = new THREE.CanvasTexture(c);
  placeholderTex.colorSpace = THREE.SRGBColorSpace;
  return placeholderTex;
}

function buildPreview(): void {
  disposePreview();
  preview = new Flower(previewDna, placeholderTexture(), selectedTemplate);
  arScene.overlayGroup.add(preview.group, preview.particles);
}

function disposePreview(): void {
  if (!preview) return;
  arScene.overlayGroup.remove(preview.group, preview.particles);
  preview.dispose();
  preview = null;
}

function showContext(): void {
  ctxNameEl.textContent = selectedTemplate.name;
  ctxStoryEl.textContent = selectedTemplate.story;
  ctxEl.classList.add('show');
}

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
  flower = new Flower(dna, captureTexture, selectedTemplate);
  arScene.overlayGroup.add(roots.group, flower.group, flower.particles);

  arScene.beginReveal(captureTexture, matted.width / matted.height);
  revealStartMs = performance.now();

  // Altar: the face was just captured on the front camera; switch to the fixed
  // hand camera so growth tracks the offered palm (the flower keeps the portrait).
  if (ALTAR_MODE) await ensureFacing('environment');

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
  ctxEl.classList.remove('show');
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

/** Prompts for the grow-from-the-mouth mode (SOWING/GROWING); other stages fall back. */
function mouthPromptFor(stage: Stage, present: boolean, openness: number): string {
  if (stage === 'SOWING') return present ? 'open your mouth, stay still' : 'bring your face to the camera';
  if (stage === 'GROWING') return openness < 0.35 ? 'open your mouth' : '';
  return promptForStage(stage, { handPresent: present, capturing: false });
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

  if (mode === 'landing') {
    const t = nowMs / 1000;
    if (preview) {
      preview.update(previewDna, previewGrowth.getState(), previewOrigin, PREVIEW_HAND_SCALE, true, t, dtSeconds);
      preview.group.rotation.y = Math.sin(t * 0.5) * 0.35; // gentle front-facing rock (overrides update)
    }
    arScene.render();
    requestAnimationFrame(loop);
    return;
  }

  const videoReady = videoEl.readyState >= 2;
  let primaryRaw: RawLandmark[] | null = null; // hand landmarks (palm mode)
  let secondaryRaw: RawLandmark[] | null = null; // second hand (palm mode: touch glitch)
  let faceLm: RawLandmark[] | null = null; // face mesh (mouth mode)
  let hand: HandState;

  if (growMode === 'mouth') {
    const fr = videoReady ? detectFace(videoEl, nowMs) : null;
    faceLm = fr?.faceLandmarks?.[0] ?? null;
    let stability = 0;
    if (faceLm) stability = stabilityTracker.update(mouthCenter(faceLm), nowMs);
    else stabilityTracker.reset();
    hand = buildMouthHandState(faceLm, stability);
    // Track a hand too, so bringing it to the bloom erupts glitch (mediated touch).
    const hres = videoReady ? detectHands(videoEl, nowMs) : null;
    const touchHand = hres?.landmarks?.[0] ?? null;
    if (touchHand && faceLm) {
      const tip = touchHand[8]!;
      hand.secondHandTip = { x: tip.x, y: tip.y, z: tip.z };
    }
  } else {
    const result = videoReady ? detectHands(videoEl, nowMs) : null;
    primaryRaw = result?.landmarks?.[0] ?? null;
    secondaryRaw = result?.landmarks?.[1] ?? null;
    let stability = 0;
    if (primaryRaw) {
      const wristKnuckle = primaryRaw[9]!;
      stability = stabilityTracker.update({ x: wristKnuckle.x, y: wristKnuckle.y, z: wristKnuckle.z }, nowMs);
    } else {
      stabilityTracker.reset();
    }
    hand = buildHandState(primaryRaw, secondaryRaw, stability);
  }
  const mirror = camera.currentFacing === 'user';

  if (stageMachine.stage === 'CAPTURE' && !capturing) {
    // Altar: the portrait is a face, so capture on the front camera. Hold the
    // timer until the front camera is actually live (e.g. after a restart that
    // was still on the hand camera).
    if (ALTAR_MODE) void ensureFacing('user');
    const camReady = !ALTAR_MODE || (camera.currentFacing === 'user' && !switchingCamera);
    if (!camReady) {
      captureCountdownStartMs = null;
    } else {
      // selfie self-timer: auto-capture after the countdown, or immediately on tap
      if (captureCountdownStartMs === null) captureCountdownStartMs = nowMs;
      const elapsed = (nowMs - captureCountdownStartMs) / 1000;
      const timedOut = elapsed >= AUTO_CAPTURE_SECONDS;
      if (timedOut || consumeManualTrigger()) {
        runCapturePipeline({ x: 0.5, y: 0.5 }).catch((err) => console.error(err)); // selfie is centered
      }
    }
  } else if (stageMachine.stage !== 'CAPTURE') {
    captureCountdownStartMs = null;
  }

  // Advance the pulse every frame so its phase stays coherent; feed it into
  // growth only in altar mode, or whenever a real board is actually live.
  const cardiac = pulse.update(dtSeconds);
  const cardiacIn = ALTAR_MODE || pulse.isLive ? cardiac : null;
  if (ALTAR_MODE) {
    pulseReadEl.textContent = `${Math.round(cardiac.bpm)} bpm ${cardiac.live ? '' : '(sim)'}`.trim();
  }

  let maturity = 0;
  let pouredOut = false;
  if (growthEngine) {
    if (stageMachine.growthGateOpen) {
      growthEngine.tick(hand, dtSeconds, cardiacIn);
    }
    const state = growthEngine.getState();
    maturity = state.maturity;
    pouredOut = growthEngine.pouredOut;

    const ctx = arScene.anchorContext();
    if (growMode === 'mouth') {
      if (faceLm) {
        landmarkToWorld(mouthCenter(faceLm), ctx, originWorld);
        handScale = Math.max(0.05, landmarkSpan(faceLm[33]!, faceLm[263]!, ctx) * 0.85);
      }
    } else if (primaryRaw) {
      landmarkToWorld(primaryRaw[9]!, ctx, originWorld);
      handScale = Math.max(0.03, landmarkSpan(primaryRaw[0]!, primaryRaw[9]!, ctx));
    }

    const t = nowMs / 1000;
    // Finger-vein roots are a palm thing; hide them when growing from the mouth.
    if (roots) {
      roots.group.visible = growMode === 'palm';
      if (growMode === 'palm') roots.update(primaryRaw, ctx, maturity);
    }
    if (currentDna) flower?.update(currentDna, state, originWorld, handScale, hand.present, t, dtSeconds, cardiacIn ? cardiac.phase : null);
    altarSound.update(state, cardiacIn, hand.present, dtSeconds);

    // Haptic beat-back: the dome plays the flower's own drifting rhythm. sendHaptic
    // is a no-op without a real board, so this is safe in simulated mode.
    if (cardiacIn && hand.present) {
      const fb = flowerHeart.update(cardiac.bpm, state.maturity, state.wiltAmount, dtSeconds);
      if (fb.beat) pulse.sendHaptic(fb.strength);
    } else {
      flowerHeart.reset();
    }
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
    if (stage === 'ENDED') {
      enteredEndedAtMs = nowMs;
      showContext();
    }
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
  } else if (growMode === 'mouth') {
    promptUI.set(mouthPromptFor(stage, hand.present, hand.openness));
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

// Start on the landing with the first flower previewed and rotating.
const startParam = new URLSearchParams(window.location.search).get('f');
selectFlower(startParam ? Math.max(0, Math.min(TEMPLATES.length - 1, parseInt(startParam, 10))) : 0);
requestAnimationFrame(loop);
