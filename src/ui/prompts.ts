import type { Stage } from '../types';

export function promptForStage(stage: Stage, opts: { handPresent: boolean; capturing: boolean }): string {
  switch (stage) {
    case 'CAPTURE':
      return opts.capturing ? 'this is who will grow' : 'find a flower. pinch and hold to capture';
    case 'SOWING':
      return 'offer your open palm';
    case 'GROWING':
      return opts.handPresent ? '' : 'stay with them';
    case 'ENDED':
      return 'tap to begin again';
  }
}

export class PromptUI {
  private el: HTMLElement;
  private lastText: string | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  set(text: string): void {
    if (text === this.lastText) return;
    this.lastText = text;
    this.el.textContent = text;
  }
}
