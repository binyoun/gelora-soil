# narcissus

A real-time WebAR work in which a participant turns to their own reflection, and that reflection takes root as a growing, mutating 3D flower held in the participant's own palm.

After Narcissus, who fell in love with his reflection and was turned into the flower. Care, stillness, and duration are the interaction grammar.

The participant captures themselves with the front camera. Their portrait is mapped onto a blooming flower that unfolds from their open palm, its petals wearing their own image, mutating and glitching for as long as the hand sustains it. Closing the hand wilts it. Tilting the palm lets it fall. Nothing is stored: each bloom exists only in the duration of holding yourself.

Part of the Gelora practice lineage.

## How it works

1. Turn to your reflection in the front camera and pinch and hold (or use the fallback shutter button) to capture yourself.
2. Offer an open, still palm to the camera. Stillness is care: the more still the hand, the faster the flower takes root.
3. Watch a flower grow from your palm, its petals mapped from your own portrait, seeded entirely by the capture. No two are the same.
4. Close your hand to let it wilt; reopen to recover.
5. Tilt your palm to let it pour out and fall.
6. A second hand can touch it to erupt it into glitch: a mediated touch.

Nothing is stored, no accounts, no gallery. Camera frames never leave the device.

## Running locally

```
npm install
npm run dev
```

Opens an HTTPS dev server (required for camera + MediaPipe). Accept the self-signed certificate warning. Works on desktop with a webcam, or over the local network from a phone on the same wifi (the `Network:` URL Vite prints).

Add `?debug=1` to the URL for an overlay showing fps, hand landmarks, and FlowerDNA values.

## Building and deploying

```
npm run build
```

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages automatically.

## Teaching notes

This project is built to later become a `webar-studio` teaching module. Points worth walking students through:

- **No trained gesture classifiers.** Every interaction (pinch, openness, tilt, stability) is derived from continuous landmark geometry in `src/hand/gestures.ts`. This is both a robustness choice and a conceptual one: the participant sustains an interaction, they do not command it.
- **Renderer-agnostic growth engine** (`src/growth/engine.ts`). It only knows about `FlowerDNA` and `HandState`, plain data, never Three.js or MediaPipe types. Everything it computes (age, maturity, wilt, petal mutations) is read by the Three.js layer and turned into visuals. This separation is what would let the same growth state later render inside a WebXR session without a rewrite.
- **Self-hosted models.** Both the HandLandmarker `.task` file and the ImageSegmenter `.tflite` file, plus the MediaPipe wasm runtime, are committed under `public/`, not loaded from a CDN. Exhibition venues often have unreliable wifi; this removes that failure mode entirely.
- **FlowerDNA** (`src/capture/dna.ts`) is a deterministic hash of the segmented capture's pixels, plus simple statistics (hue, saturation, luminance, edge density, aspect ratio). Two different flowers reliably produce visibly different numbers, which is the whole point: the being is not decorative, it is derived.

## Theoretical anchors

For exhibition text, not code: mediated touch, relational ground, intra-action (Barad), cosmotechnical ritual ecology (Hui).

## Stack

Three.js, MediaPipe Tasks Vision (HandLandmarker, ImageSegmenter), Vite, TypeScript (strict), no backend.

See `CLAUDE.md` for the full technical specification.
