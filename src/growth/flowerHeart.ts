// The flower's own heartbeat, for the pulse-ground altar's haptic beat-back.
//
// It starts locked to the visitor's pulse, then lives its own life: it drifts a
// little slower as the flower matures (becoming a separate body), drags down and
// falters as it wilts, and weakens toward death. The app sends one haptic pulse
// to the dome on each of these beats, so the visitor feels the flower become
// another life that is still them, and feels it stop.
//
// No Three.js or MediaPipe here: plain math over the growth state, like the rest
// of the growth layer.

const MATURITY_GATE = 0.12; // no heartbeat before the flower has taken

export interface FlowerBeat {
  beat: boolean; // a flower-beat occurred this frame
  strength: number; // 0..1 vitality of that beat (weaker as it dies)
  bpm: number; // the flower's current rate, for reference/haptic timing
}

export class FlowerHeart {
  private phase = 0;
  private seedBpm = 60;
  private seeded = false;

  reset(): void {
    this.phase = 0;
    this.seeded = false;
  }

  /** Advance the flower's heart and report whether it beat this frame. */
  update(visitorBpm: number, maturity: number, wilt: number, dt: number): FlowerBeat {
    if (maturity < MATURITY_GATE) {
      this.phase = 0;
      return { beat: false, strength: 0, bpm: 0 };
    }
    // Lock to the visitor's pulse the first time we have a real reading.
    if (!this.seeded && visitorBpm > 30) {
      this.seedBpm = visitorBpm;
      this.seeded = true;
    }
    const base = this.seeded ? this.seedBpm : 60;
    // Drifts slower as it matures (a separate, calmer body); wilt drags it down.
    const drift = base * (1 - maturity * 0.12) * (1 - wilt * 0.5);
    // Faltering near death: irregular intervals as wilt rises.
    const falter = 1 + (Math.random() - 0.5) * wilt * 0.6;
    const bpm = Math.max(28, drift * falter);
    const rate = bpm / 60; // beats per second

    const prev = this.phase;
    this.phase = (this.phase + rate * dt) % 1;
    const beat = this.phase < prev; // wrapped past a beat

    // Vitality: strong when bloomed and calm, fading as it wilts toward nothing.
    const strength = clamp01((0.35 + maturity * 0.65) * (1 - wilt * 0.75));
    return { beat, strength, bpm };
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
