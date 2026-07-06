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
    layers: [
      { count: 20, rMax: 0.48, scale: 1.0, tiltBias: 14 * DEG, z: 0.0 },
      { count: 18, rMax: 0.39, scale: 0.85, tiltBias: 28 * DEG, z: 0.045 },
      { count: 15, rMax: 0.3, scale: 0.68, tiltBias: 42 * DEG, z: 0.09 },
      { count: 11, rMax: 0.21, scale: 0.52, tiltBias: 56 * DEG, z: 0.13 },
      { count: 7, rMax: 0.12, scale: 0.4, tiltBias: 68 * DEG, z: 0.16 },
      { count: 4, rMax: 0.06, scale: 0.3, tiltBias: 78 * DEG, z: 0.18 },
    ],
    petal: { width: 0.07, sharp: 1.9, curl: 0.6, cup: 0.12, waveAmp: 0.04, waveFreq: 6, strap: 0.3 },
    openBaseDeg: 28,
    closeExtraDeg: 46,
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
    layers: [
      { count: 18, rMax: 0.52, scale: 1.18, tiltBias: 5 * DEG, z: 0.0 },
      { count: 15, rMax: 0.43, scale: 1.0, tiltBias: 11 * DEG, z: 0.05 },
      { count: 11, rMax: 0.31, scale: 0.76, tiltBias: 20 * DEG, z: 0.1 },
      { count: 7, rMax: 0.19, scale: 0.55, tiltBias: 30 * DEG, z: 0.14 },
    ],
    petal: { width: 0.11, sharp: 2.05, curl: 0.14, cup: 0.1, waveAmp: 0.04, waveFreq: 5, strap: 0.44 },
    openBaseDeg: 12,
    closeExtraDeg: 48,
    center: 'tuft',
    centerScale: 0.22,
    centerColor: 0xf2ecd0,
    stem: true,
    roughness: 0.4,
    emissive: 0x2a3a4a,
    emissiveIntensity: 0.35,
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
