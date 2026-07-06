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

// A cardiac reading from the pulse-ground altar (Øryn 맥). Separate from
// HandState: it comes from a physical pulse sensor, not the camera. When no
// board is connected it is synthesised (see PulseSensor) so the piece runs the
// same without hardware. Nothing is stored; the signal exists only in the moment.
export interface CardiacState {
  present: boolean; // a pulse source is active (real board or simulated)
  live: boolean; // a real board is connected (false = simulated fallback)
  bpm: number;
  phase: number; // 0..1 within the current beat, for petal breathing
  calm: number; // 0..1, heart rate settled and slow: care made measurable
  beat: boolean; // a beat edge occurred on this frame (for haptic/visual echo)
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
