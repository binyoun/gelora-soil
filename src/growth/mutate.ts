import type { FlowerDNA, MutationEvent, PetalState } from '../types';
import { mulberry32 } from '../util/rng';

/** DNA-seeded noise: hue drift, warp, asymmetry. Two captures with different DNA produce different mutation fields. */
export class MutationField {
  private rand: () => number;
  private phasePerPetal: number[];

  constructor(dna: FlowerDNA) {
    this.rand = mulberry32(dna.seed);
    this.phasePerPetal = Array.from({ length: dna.petalCount }, () => this.rand() * Math.PI * 2);
  }

  randomFloat(): number {
    return this.rand();
  }

  driftHue(dna: FlowerDNA, petalIndex: number, age: number): number {
    const phase = this.phasePerPetal[petalIndex] ?? 0;
    // Every flower shifts hue noticeably; high-spread flowers wander further and faster.
    const speed = 0.25 + dna.hueSpread * 0.5;
    const amplitude = 18 + dna.hueSpread * 45;
    return Math.sin(age * speed + phase) * amplitude;
  }

  driftWarp(dna: FlowerDNA, petalIndex: number, age: number): number {
    const phase = this.phasePerPetal[petalIndex] ?? 0;
    const floor = 0.35; // always some living movement, even for smooth-edged flowers
    return (Math.sin(age * 0.7 + phase * 1.7) * 0.5 + 0.5) * (floor + dna.edgeComplexity * (1 - floor));
  }

  applyTouch(petal: PetalState, at: number): MutationEvent {
    const hueShift = (this.rand() - 0.5) * 60;
    const warp = this.rand();
    petal.hueShift += hueShift;
    petal.warp = Math.max(petal.warp, warp);
    return { petalIndex: petal.index, hueShift, warp, at };
  }
}
