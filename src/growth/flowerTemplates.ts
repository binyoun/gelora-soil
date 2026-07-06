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
}

export const TEMPLATES: FlowerTemplate[] = [
  {
    id: 'tulip',
    name: 'semper augustus',
    story: 'a tulip whose flamed beauty was a virus that killed it. extinct.',
    symmetry: 'radial',
    layers: [
      { count: 6, rMax: 0.42, scale: 1.0, tiltBias: 0, z: 0.0 },
      { count: 6, rMax: 0.3, scale: 0.82, tiltBias: 14 * DEG, z: 0.07 },
    ],
    petal: { width: 0.5, sharp: 1.0, curl: 0.28, cup: 0.44, waveAmp: 0.17, waveFreq: 11, strap: 0 },
    openBaseDeg: 42,
    closeExtraDeg: 30,
    center: 'tuft',
    centerScale: 0.28,
    centerColor: 0x2a1a0a,
    stem: true,
    roughness: 0.52,
    emissive: 0x000000,
    emissiveIntensity: 0,
    glowTint: 0x5cc4e8,
  },
  {
    id: 'chrysanthemum',
    name: 'chrysanthemum',
    story: 'the flower of graves and mourning.',
    symmetry: 'radial',
    layers: [
      { count: 18, rMax: 0.46, scale: 1.0, tiltBias: 18 * DEG, z: 0.0 },
      { count: 16, rMax: 0.36, scale: 0.82, tiltBias: 30 * DEG, z: 0.05 },
      { count: 14, rMax: 0.26, scale: 0.64, tiltBias: 44 * DEG, z: 0.1 },
      { count: 10, rMax: 0.16, scale: 0.46, tiltBias: 58 * DEG, z: 0.14 },
      { count: 6, rMax: 0.09, scale: 0.32, tiltBias: 70 * DEG, z: 0.17 },
    ],
    petal: { width: 0.08, sharp: 1.8, curl: 0.55, cup: 0.12, waveAmp: 0.05, waveFreq: 6, strap: 0.25 },
    openBaseDeg: 30,
    closeExtraDeg: 44,
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
      { count: 16, rMax: 0.5, scale: 1.15, tiltBias: 6 * DEG, z: 0.0 },
      { count: 14, rMax: 0.42, scale: 1.0, tiltBias: 12 * DEG, z: 0.05 },
      { count: 10, rMax: 0.3, scale: 0.75, tiltBias: 22 * DEG, z: 0.1 },
    ],
    petal: { width: 0.13, sharp: 1.9, curl: 0.15, cup: 0.1, waveAmp: 0.04, waveFreq: 5, strap: 0.4 },
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
