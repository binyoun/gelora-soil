import type { CardiacState } from '../types';

// Pulse input for the "pulse ground" altar (Øryn 맥). A physical pulse sensor
// (MAX30102 PPG) on an ESP32 sits at the 수지침 heart point of the palm rest and
// streams the visitor's heartbeat over Web Serial. The flower grows on that
// pulse, and the growth gate becomes heart-rate-settling (care) rather than
// hand-jitter alone.
//
// Runs with or without hardware: if no board is connected, or the browser lacks
// Web Serial (iOS Safari), it synthesises a gentle resting pulse so the whole
// piece behaves identically. Nothing is stored; the signal exists only in the
// moment it is read.
//
// Firmware line protocol (newline-delimited ASCII over Web Serial):
//   B<bpm>\n   emitted once per detected beat, e.g. "B72"
// The instantaneous BPM sets the phase rate; the line itself is the beat edge
// (phase resyncs to 0). Any unparseable line is ignored. Baud 115200.

const BAUD = 115200;
const SIM_RESTING_BPM = 66;
const SIM_DRIFT = 5; // gentle wander of the simulated resting rate
const BEAT_HISTORY = 8; // intervals kept for the calm (variability) estimate
const SIGNAL_TIMEOUT_MS = 4000; // no real beat for this long -> fall back to simulated

// A calm heart is slow and steady. Map a low, low-variance rate toward calm 1.
const CALM_BPM_HI = 100; // at/above this, restfulness is 0
const CALM_BPM_LO = 52; // at/below this, restfulness is 1

// Minimal structural typing for Web Serial so we do not depend on lib.dom's
// optional serial types being present in the TS config.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}
function getSerial(): SerialLike | null {
  const nav = navigator as unknown as { serial?: SerialLike };
  return nav.serial ?? null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export class PulseSensor {
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private lineBuffer = '';
  private live = false;

  private bpm = SIM_RESTING_BPM;
  private phase = 0; // 0..1
  private beatEdge = false;
  private intervals: number[] = [];
  private lastBeatMs = 0;
  private lastRealBeatMs = -Infinity;

  // simulated-pulse wander state
  private simTargetBpm = SIM_RESTING_BPM;
  private simPhaseSeconds = 0;

  /** Whether this browser can talk to a serial pulse board at all. */
  get supported(): boolean {
    return getSerial() !== null;
  }

  /** A real board is currently streaming beats (vs the simulated fallback). */
  get isLive(): boolean {
    return this.live && performance.now() - this.lastRealBeatMs < SIGNAL_TIMEOUT_MS;
  }

  /**
   * Prompt the visitor to pick the serial port and start reading. Must be called
   * from a user gesture (Web Serial requirement). Resolves true once connected.
   * Failure (denied, unsupported) is non-fatal: the simulated pulse continues.
   */
  async connect(): Promise<boolean> {
    const serial = getSerial();
    if (!serial) return false;
    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: BAUD });
      this.port = port;
      this.live = true;
      this.readLoop().catch((err) => {
        console.error('pulse read loop ended', err);
        this.live = false;
      });
      return true;
    } catch (err) {
      console.error('pulse connect failed', err);
      this.live = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.live = false;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    this.reader = null;
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
  }

  private async readLoop(): Promise<void> {
    if (!this.port?.readable) return;
    this.reader = this.port.readable.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await this.reader.read();
      if (done) break;
      if (value) this.ingest(decoder.decode(value, { stream: true }));
    }
  }

  private ingest(chunk: string): void {
    this.lineBuffer += chunk;
    let nl: number;
    while ((nl = this.lineBuffer.indexOf('\n')) >= 0) {
      const line = this.lineBuffer.slice(0, nl).trim();
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      if (line.length > 1 && (line[0] === 'B' || line[0] === 'b')) {
        const value = parseFloat(line.slice(1));
        if (Number.isFinite(value) && value > 20 && value < 240) this.onBeat(value);
      }
    }
  }

  private onBeat(bpm: number): void {
    const now = performance.now();
    if (this.lastBeatMs > 0) {
      const interval = now - this.lastBeatMs;
      this.intervals.push(interval);
      if (this.intervals.length > BEAT_HISTORY) this.intervals.shift();
    }
    this.lastBeatMs = now;
    this.lastRealBeatMs = now;
    this.bpm = bpm;
    this.phase = 0;
    this.beatEdge = true;
  }

  /** Advance the pulse by dtSeconds and return the current cardiac reading. */
  update(dtSeconds: number): CardiacState {
    const beat = this.consumeBeatEdge();
    if (this.isLive) {
      // Real board: advance phase at the measured rate; onBeat resyncs it to 0.
      this.phase = (this.phase + dtSeconds * (this.bpm / 60)) % 1;
    } else {
      // Simulated resting pulse: a slow, gently wandering, steady heartbeat.
      this.simulate(dtSeconds);
    }
    return {
      present: true,
      live: this.isLive,
      bpm: this.bpm,
      phase: this.phase,
      calm: this.computeCalm(),
      beat,
    };
  }

  private consumeBeatEdge(): boolean {
    if (this.beatEdge) {
      this.beatEdge = false;
      return true;
    }
    // In simulated mode the beat edge is produced inside simulate().
    return this.simBeatEdge();
  }
  private pendingSimBeat = false;
  private simBeatEdge(): boolean {
    if (this.pendingSimBeat) {
      this.pendingSimBeat = false;
      return true;
    }
    return false;
  }

  private simulate(dt: number): void {
    // wander the target rate slowly toward a new nearby resting value
    this.simTargetBpm += (SIM_RESTING_BPM + (Math.random() - 0.5) * SIM_DRIFT - this.simTargetBpm) * dt * 0.3;
    this.bpm += (this.simTargetBpm - this.bpm) * dt * 0.5;
    this.simPhaseSeconds += dt;
    const period = 60 / this.bpm;
    if (this.simPhaseSeconds >= period) {
      this.simPhaseSeconds -= period;
      this.pendingSimBeat = true;
    }
    this.phase = this.simPhaseSeconds / period;
  }

  private computeCalm(): number {
    const restFactor = smoothstep(CALM_BPM_HI, CALM_BPM_LO, this.bpm); // low rate -> high
    if (this.intervals.length < 3) return this.isLive ? restFactor * 0.6 : restFactor;
    const mean = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
    const variance = this.intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / this.intervals.length;
    const variability = clamp01(Math.sqrt(variance) / Math.max(1, mean)); // coefficient of variation
    const steadiness = 1 - smoothstep(0.04, 0.22, variability); // steady beat -> high
    return clamp01(restFactor * steadiness);
  }
}
