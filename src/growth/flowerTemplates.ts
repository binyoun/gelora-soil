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
];

export function templateById(id: string): FlowerTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}
