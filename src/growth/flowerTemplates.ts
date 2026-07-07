// Structural templates for the four vanitas flowers. Each describes how to build
// a delicate, complex bloom (petal shape, layered arrangement, centre, stem,
// material feel). The captured selfie is mapped onto the petals and FlowerDNA
// varies colour/size/jitter within the chosen structure.

const DEG = Math.PI / 180;

export interface PetalShape {
  width: number; // half-width factor across the petal
  sharp: number; // tip pointiness (sin^sharp): higher = more pointed
  curl: number; // tip curl toward the viewer
  cup: number; // cross-section cupping
  waveAmp: number; // edge ruffle amplitude (frilliness)
  waveFreq: number; // edge ruffle frequency
  strap: number; // 0 = petal taper, 1 = long narrow strap (kadupul/tendrils)
  bend?: number; // sideways curl along the length (ghost-orchid tendrils)
  bulge?: number; // inflate the petal outward at its centre for volume (orchid lip)
}

export interface LayerSpec {
  count: number;
  rMax: number; // photo radius sampled (centre .. edge)
  scale: number;
  tiltBias: number; // extra upright tilt (radians)
  z: number; // forward offset for depth stacking
}

export type CenterStyle = 'disc' | 'tuft' | 'none';
export type Symmetry = 'radial' | 'bilateral';

export interface FlowerTemplate {
  id: string;
  name: string; // shown on the chooser
  story: string; // one-line vanitas note
  symmetry: Symmetry;
  layers: LayerSpec[]; // radial flowers only
  petal: PetalShape; // default petal shape (radial)
  openBaseDeg: number; // petal tilt when fully open
  closeExtraDeg: number; // extra tilt when closed (bud)
  center: CenterStyle;
  centerScale: number;
  centerColor: number;
  stem: boolean;
  roughness: number;
  emissive: number;
  emissiveIntensity: number;
  glowTint: number; // pour-residue glow colour
  swayAmp?: number; // per-petal flutter (radial), default 0.06
  breatheAmp?: number; // whole-bloom open/close breathing + head nod, default 0
}

export const TEMPLATES: FlowerTemplate[] = [
  {
    id: 'tulip',
    name: 'semper augustus',
    story: 'a tulip whose flamed beauty was a virus that killed it. extinct.',
    symmetry: 'radial',
    layers: [
      { count: 3, rMax: 0.42, scale: 1.0, tiltBias: 0, z: 0.0 }, // outer whorl, broader
      { count: 3, rMax: 0.28, scale: 0.82, tiltBias: 20 * DEG, z: 0.06 }, // inner whorl, narrower and more upright
    ],
    petal: { width: 0.46, sharp: 0.98, curl: 0.16, cup: 0.56, waveAmp: 0.06, waveFreq: 9, strap: 0, bulge: 0.24 }, // feathered "broken" edge, pointed chalice
    openBaseDeg: 46,
    closeExtraDeg: 24,
    center: 'tuft',
    centerScale: 0.15,
    centerColor: 0x2a1a0a,
    stem: true,
    roughness: 0.5,
    emissive: 0x000000,
    emissiveIntensity: 0,
    glowTint: 0x5cc4e8,
    swayAmp: 0.075,
    breatheAmp: 0.13,
  },
  {
    id: 'chrysanthemum',
    name: 'chrysanthemum',
    story: 'the flower of graves and mourning.',
    symmetry: 'radial',
    // a dense, rounded, incurved ball: rounded spoon petals curling inward,
    // no radiating spikes (distinct from the kadupul's flat spiky star)
    layers: [
      { count: 20, rMax: 0.44, scale: 1.0, tiltBias: 26 * DEG, z: 0.0 },
      { count: 18, rMax: 0.37, scale: 0.9, tiltBias: 42 * DEG, z: 0.05 },
      { count: 15, rMax: 0.29, scale: 0.76, tiltBias: 58 * DEG, z: 0.1 },
      { count: 12, rMax: 0.21, scale: 0.62, tiltBias: 74 * DEG, z: 0.14 },
      { count: 8, rMax: 0.13, scale: 0.48, tiltBias: 90 * DEG, z: 0.17 },
      { count: 5, rMax: 0.07, scale: 0.36, tiltBias: 102 * DEG, z: 0.19 },
    ],
    petal: { width: 0.12, sharp: 0.6, curl: 0.85, cup: 0.36, waveAmp: 0.04, waveFreq: 5, strap: 0 },
    openBaseDeg: 34,
    closeExtraDeg: 22,
    center: 'none',
    centerScale: 0,
    centerColor: 0,
    stem: true,
    roughness: 0.6,
    emissive: 0x000000,
    emissiveIntensity: 0,
    glowTint: 0x5cc4e8,
  },
  {
    id: 'kadupul',
    name: 'kadupul',
    story: 'blooms one night, dies by dawn. it cannot be picked.',
    symmetry: 'radial',
    // a flat, wide, luminous star: long thin pointed tepals radiating almost
    // level, glowing, prominent stamen tuft (distinct from the chrysanthemum ball)
    layers: [
      { count: 16, rMax: 0.56, scale: 1.35, tiltBias: 2 * DEG, z: 0.0 },
      { count: 13, rMax: 0.46, scale: 1.12, tiltBias: 6 * DEG, z: 0.045 },
      { count: 9, rMax: 0.33, scale: 0.82, tiltBias: 12 * DEG, z: 0.09 },
      { count: 6, rMax: 0.2, scale: 0.58, tiltBias: 20 * DEG, z: 0.12 },
    ],
    petal: { width: 0.085, sharp: 2.5, curl: 0.1, cup: 0.08, waveAmp: 0.03, waveFreq: 5, strap: 0.5 },
    openBaseDeg: 8,
    closeExtraDeg: 46,
    center: 'tuft',
    centerScale: 0.28,
    centerColor: 0xf2ecd0,
    stem: true,
    roughness: 0.4,
    emissive: 0x2a3a4a,
    emissiveIntensity: 0.5,
    glowTint: 0x8fe0ff,
  },
  {
    id: 'ghost',
    name: 'ghost orchid',
    story: 'endangered, rootless, it seems to float in the dark.',
    symmetry: 'bilateral',
    layers: [],
    petal: { width: 0.16, sharp: 1.6, curl: 0.1, cup: 0.12, waveAmp: 0.03, waveFreq: 5, strap: 0 },
    openBaseDeg: 0,
    closeExtraDeg: 0,
    center: 'none',
    centerScale: 0,
    centerColor: 0,
    stem: false,
    roughness: 0.45,
    emissive: 0x223344,
    emissiveIntensity: 0.28,
    glowTint: 0x9fe6ff,
  },
  {
    id: 'franklinia',
    name: 'franklinia',
    story: 'a tree found once beside a river, gone from the wild since 1803; every one alive was grown from a cutting.',
    symmetry: 'radial',
    // a broad white camellia-like bowl: rounded, faintly crinkled petals in a few
    // whorls around a dense golden stamen boss
    layers: [
      { count: 5, rMax: 0.46, scale: 1.0, tiltBias: 8 * DEG, z: 0.0 },
      { count: 5, rMax: 0.36, scale: 0.85, tiltBias: 20 * DEG, z: 0.05 },
      { count: 4, rMax: 0.25, scale: 0.66, tiltBias: 34 * DEG, z: 0.09 },
    ],
    petal: { width: 0.4, sharp: 0.7, curl: 0.14, cup: 0.42, waveAmp: 0.05, waveFreq: 7, strap: 0 },
    openBaseDeg: 40,
    closeExtraDeg: 26,
    center: 'tuft',
    centerScale: 0.3,
    centerColor: 0xe8c23a,
    stem: true,
    roughness: 0.5,
    emissive: 0x000000,
    emissiveIntensity: 0,
    glowTint: 0xdfe8ff,
    swayAmp: 0.06,
    breatheAmp: 0.05,
  },
  {
    id: 'kokio',
    name: "koki'o",
    story: 'a Hawaiian tree once down to a single plant, kept alive only by grafting it onto its cousins.',
    symmetry: 'radial',
    // a hibiscus-like whorl of narrow, upturned petals around a long stamen column
    layers: [
      { count: 5, rMax: 0.5, scale: 1.15, tiltBias: 2 * DEG, z: 0.0 },
      { count: 5, rMax: 0.28, scale: 0.62, tiltBias: 16 * DEG, z: 0.06 },
    ],
    petal: { width: 0.26, sharp: 1.1, curl: 0.5, cup: 0.3, waveAmp: 0.04, waveFreq: 5, strap: 0.1 },
    openBaseDeg: 14,
    closeExtraDeg: 42,
    center: 'tuft',
    centerScale: 0.36,
    centerColor: 0xf2d27a,
    stem: true,
    roughness: 0.45,
    emissive: 0x000000,
    emissiveIntensity: 0,
    glowTint: 0xffb27a,
    swayAmp: 0.08,
    breatheAmp: 0.08,
  },
  {
    id: 'rafflesia',
    name: 'rafflesia',
    story: 'the corpse flower, the largest bloom on earth; it opens for a few days, reeks of the dead, then rots.',
    symmetry: 'radial',
    // five huge, thick, leathery lobes around a dark spiked central disc
    layers: [
      { count: 5, rMax: 0.52, scale: 1.15, tiltBias: 6 * DEG, z: 0.0 },
    ],
    petal: { width: 0.44, sharp: 0.7, curl: 0.05, cup: 0.46, waveAmp: 0.06, waveFreq: 4, strap: 0, bulge: 0.26 },
    openBaseDeg: 44,
    closeExtraDeg: 20,
    center: 'tuft',
    centerScale: 0.34,
    centerColor: 0x2a1a1a,
    stem: true,
    roughness: 0.72,
    emissive: 0x000000,
    emissiveIntensity: 0,
    glowTint: 0x8a5a4a,
    swayAmp: 0.04,
    breatheAmp: 0,
  },
  {
    id: 'jade',
    name: 'jade vine',
    story: 'endangered, its unreal turquoise claws hang in the forest dark and glow for the bats that feed them.',
    symmetry: 'bilateral', // a pendant cluster of hooked, luminous claws (see buildJadeVine)
    layers: [],
    petal: { width: 0.05, sharp: 1.0, curl: 0.12, cup: 0.16, waveAmp: 0.03, waveFreq: 5, strap: 0.8 },
    openBaseDeg: 0,
    closeExtraDeg: 0,
    center: 'none',
    centerScale: 0,
    centerColor: 0,
    stem: false,
    roughness: 0.4,
    emissive: 0x0c3a34,
    emissiveIntensity: 0.5,
    glowTint: 0x66f0d0,
  },
];

export function templateById(id: string): FlowerTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}
