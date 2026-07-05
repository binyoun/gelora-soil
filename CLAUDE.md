# CLAUDE.md — gelora-soil (working title)

Real-time WebAR work in which a participant photographs a living flower, and that flower regenerates as a growing, mutating 3D being rooted in the participant's own palm. The body becomes the soil. Care, stillness, and duration are the interaction grammar. Part of the Gelora practice lineage; Gelora is referred to as they/them in all documentation and on-screen text.

Deployment target: GitHub Pages (static, HTTPS). Primary context: exhibition first, then adapted as a webar-studio teaching module.

Writing convention for all generated docs and UI copy: no em-dashes. Use commas, colons, or parentheses.

---

## 1. Concept summary (for on-page text and README)

The participant offers their open palm to the camera. Roots take hold across the skin. A flower they photographed moments earlier, a real flower from their surroundings, unfolds from the palm as a hybrid being: part scan, part procedural growth, mutating for as long as the hand sustains it. Closing the hand wilts them. Tilting the palm lets them fall. Nothing is stored; each being exists only in the duration of holding.

Theoretical anchors (for README/exhibition text only, not code): mediated touch, relational ground, intra-action (Barad), cosmotechnical ritual ecology (Hui).

## 2. Stack

- **Three.js** (latest stable): rendering, instancing, custom shaders
- **MediaPipe Tasks Vision**: `HandLandmarker` (2 hands, VIDEO mode), `ImageSegmenter` (selfie/category segmentation model for flower matting fallback: luminance/chroma matte)
- **Vite + TypeScript**, strict mode
- **No backend.** No storage, no analytics. Camera frames never leave the device. State is in-memory only.
- **Deploy:** GitHub Actions workflow building to `dist/`, published to GitHub Pages. Vite `base` must be set to the repo name.

Device targets: mid-range Android Chrome and iOS Safari, 30 fps minimum with camera + landmarker + render running concurrently. Desktop webcam supported for development and teaching.

## 3. Repository map

```
gelora-soil/
├── CLAUDE.md
├── README.md
├── index.html                  # single page, two <section> stages: capture, grow
├── vite.config.ts              # base: '/<repo-name>/'
├── .github/workflows/deploy.yml
├── public/
│   └── models/                 # mediapipe .task files, self-hosted
└── src/
    ├── main.ts                 # stage machine: CAPTURE -> SOWING -> GROWING -> ENDED
    ├── stages.ts               # finite state machine, transitions and guards
    ├── capture/
    │   ├── camera.ts           # getUserMedia wrapper, rear/front toggle
    │   ├── shutter.ts          # pinch-gesture shutter with 600ms hold confirm
    │   ├── segment.ts          # ImageSegmenter matte + feathered alpha, canvas out
    │   └── dna.ts              # FlowerDNA extraction from segmented capture
    ├── hand/
    │   ├── landmarker.ts       # HandLandmarker lifecycle, per-frame results
    │   ├── palm.ts             # palm plane, normal, scale, stability estimator
    │   └── gestures.ts         # openness, curl, tilt, second-hand proximity
    ├── growth/
    │   ├── engine.ts           # renderer-agnostic growth state (see section 7)
    │   ├── roots.ts            # tendril lines along finger landmark chains
    │   ├── stem.ts             # curve extrusion along palm normal
    │   ├── petals.ts           # InstancedMesh petals sampling capture texture
    │   ├── mutate.ts           # DNA-seeded noise: hue drift, warp, asymmetry
    │   └── shaders/            # displacement, unfold, wilt, petal-fall GLSL
    ├── render/
    │   ├── scene.ts            # camera-feed background plane + 3D overlay
    │   └── anchor.ts           # landmark space -> world space mapping
    └── ui/
        ├── prompts.ts          # minimal on-screen guidance text
        └── debug.ts            # ?debug=1 overlay: fps, landmarks, DNA values
```

## 4. Stage machine

```
CAPTURE  --pinch held 600ms-->  SOWING  --roots complete-->  GROWING
GROWING  --hand lost > 3s OR poured out-->  ENDED  --tap-->  CAPTURE
```

Guards: SOWING requires one open palm detected with stability score above threshold for 1.5s continuous. ENDED shows a single line of text and a restart affordance, nothing else.

## 5. FlowerDNA schema

Extracted once at capture from the segmented flower image. Seeds every downstream parameter so two captures produce structurally different beings.

```typescript
interface FlowerDNA {
  seed: number;              // hash of capture pixels, drives all PRNG
  hueCenter: number;         // 0-360, dominant hue of segmented region
  hueSpread: number;         // 0-1, hue histogram variance -> mutation range
  saturation: number;        // 0-1 mean
  luminance: number;         // 0-1 mean
  edgeComplexity: number;    // 0-1, Sobel density -> petal count + jaggedness
  aspect: number;            // bounding box w/h -> petal elongation
  petalCount: number;        // derived: 5 + round(edgeComplexity * 8)
  textureRegions: UVRect[];  // petalCount sampling rects over the capture
}
```

JSON-serializable. The growth engine consumes only this object plus per-frame `HandState`; it must never touch MediaPipe or Three.js types directly (see section 7).

## 6. Hand state and landmark mapping

```typescript
interface HandState {
  present: boolean;
  palmOrigin: Vec3;        // landmark 9 in normalized coords + pseudo-depth
  palmNormal: Vec3;        // from landmarks 0, 5, 17 cross product
  scale: number;           // wrist(0) to middle-knuckle(9) distance -> depth proxy
  openness: number;        // 0 fist .. 1 open, mean fingertip extension
  stability: number;       // 0-1, inverse of palmOrigin velocity EMA (~500ms)
  tilt: number;            // angle of palmNormal from camera axis
  secondHandTip: Vec3 | null;  // other hand index fingertip if present
}
```

| Landmark signal | Parameter | Behavior |
|---|---|---|
| palmOrigin + palmNormal | flower anchor + growth axis | stem rises perpendicular to palm, follows hand every frame (smoothed, ~120ms lag for weight) |
| scale | world scale | flower grows and shrinks with hand distance from camera |
| stability > 0.7 sustained | germination + growth rate | stillness is care; jitter slows growth toward zero, never reverses it |
| openness < 0.35 | wilt amount | fingers curling compresses the soil; petals fold, stem droops; reopening recovers over 2s |
| tilt > 60 deg | pour | petals detach as particles falling with gravity in screen space; past 50 percent loss, transition to ENDED |
| secondHandTip within radius of a petal | localized mutation | touched petal warps and shifts hue permanently; mediated touch event |
| hand lost > 3s during GROWING | ending | flower holds 1s, then dissolves; ENDED |

Gesture rule: every interaction above derives from continuous landmark geometry. No trained gesture classifiers. This is both a robustness decision and a conceptual one: the participant sustains, they do not command.

## 7. Growth engine (renderer-agnostic, phase 2 ready)

`growth/engine.ts` holds pure state: `GrowthState { age, maturity, wiltAmount, petals: PetalState[], mutations: MutationEvent[] }`, advanced by `tick(dna, hand, dt)`. Three.js code in `petals.ts`/`stem.ts` reads this state and renders it. **No Three.js imports inside engine.ts or mutate.ts.**

Reason: phase 2 (WebXR release act, section 11) re-renders the same GrowthState inside an immersive-ar session on house devices. The engine must not care which renderer or camera system owns the frame.

Growth stages within GROWING: roots (0 to 0.1 maturity, tendrils along finger chains plus contact shadow at palm), sprout (0.1 to 0.3, flat segmented image rises as a plane and gains depth displacement), unfold (0.3 to 0.6, plane splits into instanced petals, each textured by its `textureRegions` rect), bloom and mutate (0.6 to 1.0, DNA-seeded drift continues indefinitely; maturity 1.0 is asymptotic, never reached).

## 8. Capture pipeline

1. Rear camera by default, front-camera toggle in corner.
2. HandLandmarker runs during capture too: pinch (thumb tip 4 to index tip 8 below distance threshold) held 600ms fires the shutter. Fallback tap button always visible (accessibility, teaching contexts).
3. Frame frozen to offscreen canvas. ImageSegmenter mattes the central subject; if confidence is poor, fall back to a radial-feathered luminance matte centered on the pinch point. Never block: worst case, the whole frame becomes the texture.
4. `dna.ts` computes FlowerDNA from the matted pixels.
5. Show the segmented flower floating for 1.5s ("this is who will grow"), then prompt: offer your open palm.

## 9. Performance budgets

- HandLandmarker: run at video resolution capped 640px on the long edge, VIDEO mode, 2 hands max.
- ImageSegmenter: invoked once per capture only, never per-frame.
- Petals: single InstancedMesh, max 16 instances. Roots: line segments, max 200 vertices. Particles: one Points cloud, max 400.
- All mutation and wilt animation in vertex/fragment shaders driven by uniforms; no per-frame geometry rebuilds.
- Frame budget check in debug overlay; if fps < 24 for 3s, halve pixel ratio automatically.

## 10. Milestones (phase-gated, do not advance past a failing gate)

**M1, Hands and anchor.** Camera feed background, HandLandmarker live, debug overlay drawing landmarks, palm plane and normal computed, a placeholder cone anchored to the palm tracking at 30 fps on a mid-range phone. Gate: cone stays visually rooted through rotation, tilt, and distance change.

**M2, Capture and DNA.** Pinch shutter, segmentation, FlowerDNA extraction, values visible in debug overlay. Gate: two different flowers produce visibly different DNA numbers.

**M3, Growth engine.** Roots, sprout, unfold, bloom implemented against a hardcoded DNA. Stillness gating and openness wilt working. Gate: full lifecycle from open palm to ending, no console errors, 30 fps.

**M4, Integration and interaction.** Real DNA drives growth. Second-hand touch mutation, tilt pour, ending states. Gate: complete experience start to finish on Android Chrome and iOS Safari.

**M5, Deploy and polish.** GitHub Actions to Pages, camera permission UX, on-screen prompts (minimal, lowercase, one line at a time), README with concept text and teaching notes. Gate: fresh phone, scan QR, full experience with no instruction beyond on-screen prompts.

## 11. Phase 2 (out of scope now, do not build, do not preclude)

WebXR release act on Chrome Android house devices: an offering gesture (palm rising past shoulder height with openness 1.0) detaches the being; session hands off to immersive-ar with hit-test; the same GrowthState re-renders anchored to a world surface and persists after the hand withdraws. The renderer-agnostic engine (section 7) exists so this becomes a new render target, not a rewrite.

## 12. Non-goals

No accounts, no storage, no server, no gallery of past flowers, no screenshots feature in v1, no trained gesture models, no WebXR in v1.
