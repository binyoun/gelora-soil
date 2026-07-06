import type { CardiacState, GrowthState } from '../types';

// Sound concept A, "the auscultation", for the pulse-ground altar.
//
// Near-silence with three quiet layers, all synthesised (no samples, fully
// self-contained), driven by the flower's growth state and the visitor's pulse:
//
//   1. a low felt thump on every heartbeat (the tactile-transducer layer, which
//      on a speaker reads as a soft kick),
//   2. single celadon-bell partials struck on the beat once the flower has
//      taken, brighter and denser as it matures,
//   3. a sustained drone that fades in with maturity and detunes sour as the
//      flower wilts, falling to silence when the bloom is let go.
//
// Vanitas as the return to silence. Nothing is recorded; the sound exists only
// while the flower is held. Web Audio needs a user gesture, so call resume()
// from the same tap that begins the piece.

// A minor pentatonic on A, low to high. Bells are chosen from a window into this
// that widens (brighter) as the flower matures.
const BELL_HZ = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
const DRONE_ROOT = 110.0; // A2
const DRONE_FIFTH = 164.81; // E3
const MASTER_CEIL = 0.22; // this piece is quiet by design

export class AltarSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private enabled = false;
  private level = 0; // smoothed master level

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** Create and start the audio graph. Must be called from a user gesture. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.build();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Drone: root plus fifth, gently detuned voices through a soft lowpass.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 500;
    this.droneFilter.Q.value = 0.4;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain).connect(this.master);

    for (const [i, hz] of [DRONE_ROOT, DRONE_ROOT, DRONE_FIFTH].entries()) {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = hz;
      o.detune.value = (i - 1) * 5; // a few cents apart for a living beat
      o.connect(this.droneFilter!);
      o.start();
      this.droneOscs.push(o);
    }
  }

  /** Advance the sound one frame. Silent and cheap until resume() has run. */
  update(growth: GrowthState | null, cardiac: CardiacState | null, present: boolean, dt: number): void {
    if (!this.ctx || !this.master || !this.droneGain || !this.droneFilter) return;

    const maturity = growth ? growth.maturity : 0;
    const wilt = growth ? growth.wiltAmount : 0;
    const alive = this.enabled && present;

    // Master fades in with maturity, out with wilt, and to silence when let go.
    const target = alive ? smoothstep(0.06, 0.5, maturity) * MASTER_CEIL * (1 - wilt * 0.6) : 0;
    this.level += (target - this.level) * (1 - Math.exp(-dt / (target > this.level ? 0.6 : 1.4)));
    this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.05);

    // Drone brightens with maturity, darkens and sours with wilt.
    this.droneGain.gain.setTargetAtTime(0.5 + maturity * 0.5, this.ctx.currentTime, 0.2);
    this.droneFilter.frequency.setTargetAtTime(360 + maturity * 900 - wilt * 500, this.ctx.currentTime, 0.2);
    for (const [i, o] of this.droneOscs.entries()) {
      o.detune.setTargetAtTime((i - 1) * 5 + wilt * 22, this.ctx.currentTime, 0.3); // wilt detunes sour
    }

    // Strike on each heartbeat once the flower has taken.
    if (alive && cardiac && cardiac.beat) {
      this.thump(cardiac.calm);
      if (maturity > 0.14) this.bell(maturity, cardiac.calm);
    }
  }

  /** A low, short kick under each beat: the felt-heartbeat layer. */
  private thump(calm: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const peak = 0.16 * (0.6 + calm * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.24);
  }

  /** A single struck partial: fast attack, long exponential ring, like a small bell. */
  private bell(maturity: number, calm: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Brighter, wider note window as the flower matures.
    const window = 2 + Math.floor(maturity * (BELL_HZ.length - 2));
    const hz = BELL_HZ[Math.floor(Math.random() * window)]!;
    const partials = maturity > 0.55 ? [1, 2.01] : [1];
    const decay = 1.6 + calm * 1.4; // a calm heart rings longer
    const amp = 0.05 * (0.5 + calm * 0.5) * (0.6 + maturity * 0.4);
    for (const [k, mult] of partials.entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = hz * mult;
      const a = amp * (k === 0 ? 1 : 0.4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  dispose(): void {
    for (const o of this.droneOscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.droneOscs = [];
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
