# vanitas

A real-time WebAR work in which a participant's own reflection blooms as a flower that is already lost, and lives only as long as they hold themselves.

A contemporary vanitas: where the Dutch still-life set beauty beside a skull, this sets the self beside extinction. You choose which doomed flower you become, and your portrait is mapped onto its petals.

The four flowers:

- **Semper Augustus** — the flamed "broken" tulip of tulip-mania, whose beauty was a mosaic virus that killed the bulbs. Extinct.
- **Chrysanthemum** — the flower of graves and mourning.
- **Kadupul** — the night-blooming cereus; blooms once at night, dies by dawn, and cannot be picked without dying.
- **Ghost orchid** — endangered, rootless, seeming to float in the dark.

The participant captures themselves with the front camera. Their portrait unfolds across the chosen flower, mutating and glitching for as long as the hand sustains it. Closing the hand wilts it. Tilting the palm lets it pour away as motes of light. Nothing is stored: each bloom exists only in the duration of holding yourself.

Part of the Gelora practice lineage.

## How it works

1. On the landing page, choose which extinct or endangered flower you become.
2. Turn to the front camera; a 3-second timer captures your selfie automatically (or tap to capture now).
3. Offer an open, still palm. Stillness is care: the more still the hand, the faster the flower takes root.
4. Your chosen flower grows from your palm wearing your own portrait, seeded by the capture. No two are the same.
5. Close your hand to wilt it; reopen to recover. Tilt your palm to let it pour away.
6. Bring a second hand near it to erupt it into glitch: a mediated touch.

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
