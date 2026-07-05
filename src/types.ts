export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface UVRect {
  u: number;
  v: number;
  w: number;
  h: number;
}

export interface FlowerDNA {
  seed: number;
  hueCenter: number;
  hueSpread: number;
  saturation: number;
  luminance: number;
  edgeComplexity: number;
  aspect: number;
  petalCount: number;
  textureRegions: UVRect[];
}

export interface HandState {
  present: boolean;
  palmOrigin: Vec3;
  palmNormal: Vec3;
  scale: number;
  openness: number;
  stability: number;
  tilt: number;
  secondHandTip: Vec3 | null;
}

export interface MutationEvent {
  petalIndex: number;
  hueShift: number;
  warp: number;
  at: number;
}

export interface PetalState {
  index: number;
  fold: number;
  hueShift: number;
  warp: number;
  detached: boolean;
  fallProgress: number;
}

export interface GrowthState {
  age: number;
  maturity: number;
  wiltAmount: number;
  petals: PetalState[];
  mutations: MutationEvent[];
}

export type Stage = 'CAPTURE' | 'SOWING' | 'GROWING' | 'ENDED';
