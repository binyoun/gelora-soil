# vanitas

A real-time WebAR work in which a participant's own reflection blooms as a flower that is already lost, and lives only as long as they hold themselves.

Live: https://binyoun.github.io/gelora-soil/

Front camera, no install, no backend. Part of the Gelora practice lineage. Repo name is `gelora-soil` (the working title); the piece is titled `vanitas`.

---

## Concept

A contemporary vanitas. Where the Dutch still-life set beauty beside a skull, this sets the self beside extinction. You choose which doomed flower you become; a self-timer photographs you; and your portrait is mapped onto the petals of a 3D flower that grows from your open palm, mutating and glitching for as long as you hold it still. Close your hand and it wilts. Tilt your palm and it pours away as motes of light. Nothing is stored. Each bloom exists only in the duration of holding yourself.

The interaction grammar is care, stillness, and duration: the flower takes root only while the hand is offered and still, and it is never saved. Vanity, beauty, and transience become the same gesture.

### The ten flowers

Each is extinct, endangered, or ephemeral. You wear whichever you choose.

- **Semper Augustus** (a broken tulip). The most prized flower of the 1630s tulip mania, its flame-streaked beauty caused by a mosaic virus that eventually killed the bulbs. Now extinct.
- **Chrysanthemum**. The flower of graves and mourning across Europe and East Asia.
- **Kadupul** (a night-blooming cereus). Blooms once at night and dies by dawn; it cannot be picked without dying.
- **Ghost orchid**. Endangered, rootless, seeming to float in the dark.
- **Franklinia**. A tree found once beside a river in Georgia, extinct in the wild since 1803; every specimen alive was grown from a cutting.
- **Koki'o** (Kokia cookei). A Hawaiian tree once reduced to a single plant, kept alive only by grafting it onto its relatives.
- **Rafflesia**. The corpse flower, the largest bloom on earth; it opens for a few days, smells of the dead, and rots. Endangered as its forests fall.
- **Jade vine** (Strongylodon macrobotrys). Endangered; its unreal turquoise claw-shaped flowers hang in long cascades and glow in the forest dark for the bats that pollinate them. The one bilateral bloom besides the ghost orchid.
- **Chocolate cosmos** (Cosmos atrosanguineus). Extinct in the wild; every plant is a clone of one, it smells of chocolate and sets no seed. A dark, flat daisy.
- **Middlemist's red**. The rarest flower on earth: only two plants are known, one behind glass in London, one in a New Zealand garden. A full formal camellia.

---

## How it works

1. **Landing.** A 3D preview of the chosen flower rotates gently over a dark ground, tinted with the flower's own colour. Swipe left or right (or tap the side chevrons) to change flower, and choose to grow it from the palm or from the open mouth. Tap anywhere to become the current one.
2. **Capture.** A 3-second self-timer photographs you with the front camera (tap to capture immediately). The portrait is segmented from the background on-device.
3. **Sow.** Offer an open, still palm to the camera (or, in mouth mode, bring your face close and hold still). Stillness is care: the steadier you are, the faster the flower takes root.
4. **Grow.** Your chosen flower grows from your palm wearing your own portrait, seeded by the capture so no two are the same. It keeps mutating for as long as you hold it.
5. **Tend.** Close your hand to wilt it; reopen to recover. Tilt your palm past horizontal to let it pour away as glowing water-blue motes (tilt back before it is mostly gone and it recovers).
6. **Touch.** Bring a second hand near the bloom to erupt it into glitch: a mediated touch.
7. **End.** When the flower is lost, its name and story fade in. Tap anywhere to begin again, or use the back arrow to return to the landing and choose a different flower.

Nothing is stored. No accounts, no gallery, no analytics. Camera frames never leave the device; all processing (hand tracking, segmentation, rendering) is local.

---

## Stack

- **Three.js** (rendering, custom geometry, PBR + PMREM environment, custom shaders)
- **MediaPipe Tasks Vision**: `HandLandmarker` (2 hands, VIDEO mode), `FaceLandmarker` (1 face, for the grow-from-the-mouth mode), and `ImageSegmenter` (selfie segmentation), models and wasm runtime self-hosted under `public/`
- **Vite + TypeScript** (strict)
- **No backend.** State is in-memory only. Deployed as static files to GitHub Pages via GitHub Actions.

Device targets: mid-range Android Chrome and iOS Safari, front camera, aiming for 30 fps with camera plus landmarker plus render running together. Desktop webcam works for development.

---

## Architecture

### Rendering foundation

The camera feed is a plain fullscreen DOM `<video>` (`object-fit: cover`), and the WebGL canvas is transparent on top of it (`alpha` renderer, `clearColor(0,0)`). This is far more robust than texturing the feed onto a plane inside the scene. `src/render/scene.ts` owns the renderer, an ACES-tone-mapped pipeline, and a soft PMREM `RoomEnvironment` so `MeshStandardMaterial` reads with real shading and gentle reflections.

3D content is anchored to the hand with `camera.unproject`: `src/render/anchor.ts` converts a MediaPipe landmark (raw sensor-frame coordinates) into on-screen coordinates, correcting for the `object-fit: cover` crop and front-camera mirroring, then unprojects to a fixed distance. Depth is fixed rather than taken from MediaPipe's unreliable pseudo-z, so the flower always renders where the hand appears.

### Capture and FlowerDNA

`src/capture/camera.ts` wraps `getUserMedia` (front by default). On capture, `src/capture/segment.ts` mattes the person out of a frozen frame with the ImageSegmenter (with a radial-luminance fallback so it never blocks). `src/capture/dna.ts` derives a `FlowerDNA` from the matted pixels: a deterministic seed (a hash of the capture), dominant hue, saturation, luminance, edge complexity, aspect, and a derived petal count. DNA seeds every downstream random choice so a given capture always grows the same being, and two captures grow different ones.

### Growth engine (renderer-agnostic)

`src/growth/engine.ts` holds pure state (age, maturity, wilt, per-petal state, mutation events), advanced by `tick(hand, dt)`. It imports no Three.js or MediaPipe types, so the same growth could later drive a WebXR renderer without a rewrite. Growth is asymptotic (maturity approaches but never reaches 1), fast to emerge then slow to bloom, gated by hand stillness. Wilt, pour (recoverable), and mediated-touch mutation all live here. `src/stages.ts` is the stage machine: CAPTURE, SOWING, GROWING, ENDED.

### The flower model

The being is a DNA-driven 3D model that wears the captured selfie, built from a `FlowerTemplate`:

- `src/growth/flowerTemplates.ts` defines the ten flowers as data: layered petal arrangement, a `PetalShape` (width, tip sharpness, curl, cup, edge ruffle, strap vs taper, sideways `bend`, center `bulge`), open/closed tilt range, center style, stem, material feel, glow tint, and the vanitas story.
- `src/growth/flower.ts` builds from a template. Radial flowers (tulip, chrysanthemum, kadupul, franklinia, koki'o, rafflesia, chocolate cosmos, Middlemist's red) assemble many petals in concentric layers; each petal is its own mesh whose UVs sample a radial wedge of the selfie, so the assembled bloom reconstructs the portrait in 3D. Two flowers are bilateral with their own build paths: the ghost orchid (slender upper sepals, a voluminous cupped lip, a little central rosette, two long curling tails) and the jade vine (an upright crown over a cascade of long hooked claws), each part with its own floating drift.
- The same growth state drives every flower: petals open with maturity, droop with wilt, shed on pour, and glitch on touch. `FlowerDNA` still varies color, size, and jitter within the chosen structure.

### Glitch and residue

`src/growth/glitchMaterial.ts` patches the petal `MeshStandardMaterial` via `onBeforeCompile` (keeping its PBR lighting) to add glitch: horizontal-streak chromatic fringing plus a per-vertex wobble, driven by a `uGlitch` level that surges on a mediated-touch mutation. Pour residue is rendered as soft, additive, glowing billboard quads that fade like droplets of light (not hard points), in `flower.ts`.

### Landing and app modes

`src/main.ts` runs a single render loop across two modes. In `landing` mode it renders a rotating preview of the chosen flower (with a neutral placeholder texture) and handles swipe/tap selection. In `ar` mode it runs the capture, growth, and interaction flow over the live camera. The back arrow returns to the landing; an elegant loader covers the first camera and model load.

---

## Project structure

```
vanitas/  (repo: gelora-soil)
- index.html               single page: landing overlay, AR chrome, one WebGL canvas over the DOM video
- src/
  - main.ts                app modes (landing/ar), stage flow, capture pipeline, chooser, loop
  - stages.ts              CAPTURE -> SOWING -> GROWING -> ENDED state machine
  - types.ts               FlowerDNA, HandState, GrowthState, PetalState, MutationEvent
  - capture/
    - camera.ts            getUserMedia wrapper, front/rear toggle
    - segment.ts           ImageSegmenter matte + radial-luminance fallback
    - dna.ts               FlowerDNA extraction from the matted selfie
  - hand/
    - landmarker.ts        HandLandmarker lifecycle
    - palm.ts              palm origin/normal/scale, stability estimator
    - gestures.ts          openness, pinch, tilt (folded), second-hand proximity
  - growth/
    - engine.ts            renderer-agnostic growth state (no three/mediapipe)
    - mutate.ts            DNA-seeded hue/warp drift
    - flowerTemplates.ts   the four FlowerTemplates + PetalShape
    - flower.ts            template-driven flower model, radial + bilateral, pour residue
    - glitchMaterial.ts    onBeforeCompile glitch patch
    - roots.ts             faint finger-vein tendrils
  - render/
    - scene.ts             transparent renderer, PMREM env, reveal plane
    - anchor.ts            landmark -> world via unproject, cover-crop + mirror
  - ui/
    - prompts.ts           one-line prompts
    - debug.ts             ?debug=1 overlay (fps, landmarks, DNA, maturity)
  - util/                  seeded RNG (mulberry32), vec3 helpers
- public/
  - models/                hand_landmarker.task, selfie_segmenter.tflite (self-hosted)
  - vendor/mediapipe-wasm/ MediaPipe wasm runtime (self-hosted, no CDN)
- .github/workflows/deploy.yml   build + publish to GitHub Pages
```

---

## Running locally

```
npm install
npm run dev
```

Opens an HTTPS dev server (required for camera and MediaPipe). Accept the self-signed certificate warning. Works on desktop with a webcam, or from a phone on the same wifi (the `Network:` URL Vite prints).

Add `?debug=1` for an overlay with fps, hand landmarks, DNA values, and maturity/wilt. Add `?f=0..3` to preview a specific flower on the landing (a development aid).

```
npm run typecheck   # tsc --noEmit
npm run build       # production build to dist/
npm run preview     # serve the build
```

## Deploying

Push to `main`; `.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages. Vite `base` is set to the repo name. If the deploy step reports a transient "Deployment failed, try again later" (a GitHub Pages backend hiccup, the build itself succeeds), re-run the failed job or re-dispatch the workflow.

## Self-hosted models

Both the HandLandmarker `.task` file and the ImageSegmenter `.tflite`, plus the MediaPipe wasm runtime, are committed under `public/` and loaded locally rather than from a CDN. Exhibition venues often have unreliable wifi; self-hosting removes that failure mode entirely.

## Performance budgets

- HandLandmarker: VIDEO mode, 2 hands max.
- ImageSegmenter: invoked once per capture, never per-frame.
- Only one flower is active at a time. The densest (chrysanthemum, kadupul) run around 40 to 64 petal meshes; if a device stalls, the next optimization is to batch petals into an `InstancedMesh` with per-instance attributes.
- Pour residue is capped. If fps stays below 24 for 3 seconds, pixel ratio halves automatically.

---

## Teaching notes

This is built to double as a `webar-studio` teaching module. Points worth walking students through:

- **No trained gesture classifiers.** Every interaction (self-timer aside) is derived from continuous hand-landmark geometry in `src/hand/gestures.ts`. A robustness choice and a conceptual one: the participant sustains an interaction, they do not command it.
- **Renderer-agnostic growth engine.** `engine.ts` only knows `FlowerDNA` and `HandState`, plain data. The Three.js layer reads its state and renders it. This separation is what would let the same growth render inside a WebXR session without a rewrite.
- **Data-driven flowers.** New flowers are added by writing a `FlowerTemplate`, not new rendering code. The petal-shape parameters (`sharp`, `cup`, `curl`, `strap`, `bend`, `bulge`, ruffle) are a small vocabulary that spans very different species.
- **Self-hosted models** for offline reliability, and a transparent-canvas-over-DOM-video foundation that avoids the fragility of texturing the feed into the scene.

## Notes

Writing convention for all copy and docs: no em-dashes; commas, colons, or parentheses instead.
