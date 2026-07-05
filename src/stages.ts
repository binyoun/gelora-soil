import type { HandState, Stage } from './types';

const SOWING_STABILITY_THRESHOLD = 0.4;
const SOWING_HOLD_MS = 700;
const ROOTS_COMPLETE_MATURITY = 0.08;
const HAND_LOST_TIMEOUT_MS = 3000;

export interface StageInputs {
  shutterFired: boolean;
  hand: HandState;
  maturity: number;
  pouredOut: boolean;
  timestampMs: number;
  restartRequested: boolean;
}

/** CAPTURE -pinch-> SOWING -roots complete-> GROWING -lost/poured-> ENDED -tap-> CAPTURE */
export class StageMachine {
  stage: Stage = 'CAPTURE';
  sowingCommitted = false;

  private sowingStableSinceMs: number | null = null;
  private handLostSinceMs: number | null = null;

  update(input: StageInputs): Stage {
    switch (this.stage) {
      case 'CAPTURE':
        if (input.shutterFired) this.enter('SOWING');
        break;

      case 'SOWING': {
        const eligible = input.hand.present && input.hand.stability > SOWING_STABILITY_THRESHOLD;
        if (eligible) {
          if (this.sowingStableSinceMs === null) this.sowingStableSinceMs = input.timestampMs;
          if (!this.sowingCommitted && input.timestampMs - this.sowingStableSinceMs >= SOWING_HOLD_MS) {
            this.sowingCommitted = true;
          }
        } else {
          this.sowingStableSinceMs = null;
        }

        if (this.sowingCommitted && input.maturity >= ROOTS_COMPLETE_MATURITY) {
          this.enter('GROWING');
        }
        break;
      }

      case 'GROWING': {
        if (!input.hand.present) {
          if (this.handLostSinceMs === null) this.handLostSinceMs = input.timestampMs;
          if (input.timestampMs - this.handLostSinceMs > HAND_LOST_TIMEOUT_MS) {
            this.enter('ENDED');
          }
        } else {
          this.handLostSinceMs = null;
        }

        if (input.pouredOut) this.enter('ENDED');
        break;
      }

      case 'ENDED':
        if (input.restartRequested) this.enter('CAPTURE');
        break;
    }

    return this.stage;
  }

  /** Growth accumulates once SOWING's 1.5s stillness commitment is met, or once past SOWING entirely. */
  get growthGateOpen(): boolean {
    return this.stage === 'GROWING' || (this.stage === 'SOWING' && this.sowingCommitted);
  }

  private enter(stage: Stage): void {
    this.stage = stage;
    if (stage === 'CAPTURE' || stage === 'SOWING') {
      this.sowingStableSinceMs = null;
      this.sowingCommitted = false;
    }
    if (stage !== 'GROWING') {
      this.handLostSinceMs = null;
    }
  }
}
