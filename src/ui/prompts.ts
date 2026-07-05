import type { Stage } from '../types';

export function promptForStage(stage: Stage, opts: { handPresent: boolean; capturing: boolean }): string {
  switch (stage) {
    case 'CAPTURE':
      return opts.capturing ? 'this is who you become' : 'turn to your reflection, pinch and hold';
    case 'SOWING':
      return opts.handPresent ? 'hold your open palm still' : 'offer your open palm';
    case 'GROWING':
      return opts.handPresent ? '' : 'stay with yourself';
    case 'ENDED':
      return 'tap to begin again';
  }
}

/** One line at a time, cross-faded on change (CSS transitions opacity on #prompt). */
export class PromptUI {
  private el: HTMLElement;
  private lastText: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  set(text: string): void {
    if (text === this.lastText) return;
    this.lastText = text;
    this.el.style.opacity = '0';
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.el.textContent = text;
      this.el.style.opacity = text ? '1' : '0';
    }, 220);
  }
}
