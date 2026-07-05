import type { FlowerDNA, GrowthState, HandState, PetalState, Vec3 } from '../types';
import { distance } from '../util/vec3';
import { MutationField } from './mutate';

// No Three.js or MediaPipe imports here. Phase 2 (WebXR) re-renders this same
// state inside an immersive-ar session; the engine must not care who owns the frame.

const STABILITY_GROWTH_FLOOR = 0.08;
const STABILITY_GROWTH_CEIL = 0.5;
const BASE_GROWTH_RATE = 0.4; // maturity/sec approach rate at full stillness

const WILT_OPENNESS_THRESHOLD = 0.35;
const WILT_CLOSE_TIME_S = 0.4;
const WILT_RECOVER_TIME_S = 2.0;

const POUR_TILT_THRESHOLD_DEG = 60;
const POUR_DETACH_RATE = 0.6; // detach probability/sec at full over-tilt
const POUR_FALL_DURATION_S = 2.5;

const TOUCH_RADIUS = 0.09; // normalized landmark-space units
const TOUCH_COOLDOWN_S = 1.0;
const PETAL_ORBIT_RADIUS = 0.12;
const PETAL_ORBIT_SPEED = 0.15; // rad/s

export type EndingReason = 'hand-lost' | 'poured-out' | null;

export function createGrowthState(dna: FlowerDNA): GrowthState {
  const petals: PetalState[] = Array.from({ length: dna.petalCount }, (_, index) => ({
    index,
    fold: 0,
    hueShift: 0,
    warp: 0,
    detached: false,
    fallProgress: 0,
  }));
  return { age: 0, maturity: 0, wiltAmount: 0, petals, mutations: [] };
}

export class GrowthEngine {
  private mutation: MutationField;
  private lastTouchAge: number[];
  private state: GrowthState;

  constructor(private dna: FlowerDNA, initialState: GrowthState = createGrowthState(dna)) {
    this.state = initialState;
    this.mutation = new MutationField(dna);
    this.lastTouchAge = new Array(dna.petalCount).fill(-Infinity);
  }

  getState(): GrowthState {
    return this.state;
  }

  get detachedRatio(): number {
    const total = this.state.petals.length;
    if (total === 0) return 0;
    return this.state.petals.filter((p) => p.detached).length / total;
  }

  get pouredOut(): boolean {
    return this.detachedRatio > 0.5;
  }

  /** Advances growth by dtSeconds given the current DNA and per-frame hand reading. */
  tick(hand: HandState, dtSeconds: number): GrowthState {
    const s = this.state;
    s.age += dtSeconds;

    this.advanceMaturity(hand, dtSeconds);
    this.advanceWilt(hand, dtSeconds);
    this.advancePour(hand, dtSeconds);
    this.advanceBloom(hand, dtSeconds);

    return s;
  }

  private advanceMaturity(hand: HandState, dt: number): void {
    const s = this.state;
    const growthFactor = smoothstep(STABILITY_GROWTH_FLOOR, STABILITY_GROWTH_CEIL, hand.stability);
    const growthRate = BASE_GROWTH_RATE * growthFactor;
    // Asymptotic approach toward 1: growth never reverses, jitter only slows it toward zero.
    s.maturity += (1 - s.maturity) * growthRate * dt;
    s.maturity = Math.min(s.maturity, 0.999999);
  }

  private advanceWilt(hand: HandState, dt: number): void {
    const s = this.state;
    const wiltTarget = hand.openness < WILT_OPENNESS_THRESHOLD
      ? clamp01(1 - hand.openness / WILT_OPENNESS_THRESHOLD)
      : 0;
    const timeConstant = wiltTarget > s.wiltAmount ? WILT_CLOSE_TIME_S : WILT_RECOVER_TIME_S;
    const alpha = 1 - Math.exp(-dt / timeConstant);
    s.wiltAmount += (wiltTarget - s.wiltAmount) * alpha;
  }

  private advancePour(hand: HandState, dt: number): void {
    const s = this.state;
    if (hand.tilt > POUR_TILT_THRESHOLD_DEG) {
      const overTilt = (hand.tilt - POUR_TILT_THRESHOLD_DEG) / (180 - POUR_TILT_THRESHOLD_DEG);
      const detachChance = POUR_DETACH_RATE * clamp01(overTilt) * dt;
      for (const petal of s.petals) {
        if (!petal.detached && this.mutation.randomFloat() < detachChance) {
          petal.detached = true;
        }
      }
    }
    for (const petal of s.petals) {
      if (petal.detached) {
        petal.fallProgress = Math.min(1, petal.fallProgress + dt / POUR_FALL_DURATION_S);
      }
    }
  }

  private advanceBloom(hand: HandState, dt: number): void {
    const s = this.state;
    // Mutation begins as soon as petals appear, so the being reads as alive early.
    if (s.maturity <= 0.12) return;

    for (const petal of s.petals) {
      if (petal.detached) continue;
      // Strong, continuous hue wander and warp so the being visibly keeps
      // mutating for as long as it is held, not settling into a static bloom.
      petal.hueShift += this.mutation.driftHue(this.dna, petal.index, s.age) * dt * 1.2;
      const target = this.mutation.driftWarp(this.dna, petal.index, s.age);
      const warpAlpha = 1 - Math.exp(-dt / 0.6);
      petal.warp = clamp01(petal.warp + (target - petal.warp) * warpAlpha);
    }

    if (!hand.secondHandTip) return;
    const touched = this.findTouchedPetal(hand);
    if (!touched) return;

    if (s.age - (this.lastTouchAge[touched.index] ?? -Infinity) < TOUCH_COOLDOWN_S) return;
    this.lastTouchAge[touched.index] = s.age;
    const event = this.mutation.applyTouch(touched, s.age);
    s.mutations.push(event);
  }

  private findTouchedPetal(hand: HandState): PetalState | null {
    if (!hand.secondHandTip) return null;
    for (const petal of this.state.petals) {
      if (petal.detached) continue;
      const pos = this.petalPosition(petal, hand);
      if (distance(pos, hand.secondHandTip) < TOUCH_RADIUS) return petal;
    }
    return null;
  }

  /** Approximate petal center in the same normalized landmark space as HandState, for touch hit-testing. */
  petalPosition(petal: PetalState, hand: HandState): Vec3 {
    const angle = (petal.index / this.dna.petalCount) * Math.PI * 2 + this.state.age * PETAL_ORBIT_SPEED;
    const radius = PETAL_ORBIT_RADIUS * smoothstep(0.3, 0.6, this.state.maturity);
    return {
      x: hand.palmOrigin.x + Math.cos(angle) * radius,
      y: hand.palmOrigin.y + Math.sin(angle) * radius,
      z: hand.palmOrigin.z,
    };
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
