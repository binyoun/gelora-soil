# gelora-soil

A real-time WebAR work in which a participant photographs a living flower, and that flower regenerates as a growing, mutating 3D being rooted in the participant's own palm.

The body becomes the soil. Care, stillness, and duration are the interaction grammar.

The participant offers their open palm to the camera. Roots take hold across the skin. A flower they photographed moments earlier, a real flower from their surroundings, unfolds from the palm as a hybrid being: part scan, part procedural growth, mutating for as long as the hand sustains it. Closing the hand wilts them. Tilting the palm lets them fall. Nothing is stored: each being exists only in the duration of holding.

Part of the Gelora practice lineage. Gelora is referred to as they/them throughout.

## How it works

1. Photograph a flower in your surroundings (pinch and hold, or use the fallback shutter button).
2. Offer an open, still palm to the camera. Stillness is care: the more still the hand, the faster the being takes root.
3. Watch roots, then a stem, then petals unfold from your palm, seeded entirely by the flower you photographed. No two captures grow the same being.
4. Close your hand to let the being wilt; reopen to recover.
5. Tilt your palm past horizontal to let the being pour out and fall.
6. A second hand's fingertip can touch a petal directly to warp and permanently shift its hue: a mediated touch.

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
