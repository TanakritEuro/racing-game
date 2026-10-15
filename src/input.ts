import type { Controls } from './vehicle/car';

/**
 * Keyboard → Controls. Keys are digital: `steer` here is −1, 0 or +1, and the steering
 * assist (`drivers/steeringAssist.ts`) turns it into a steering position each step.
 * E / Q shift up / down: each press is one shift request, taken by the next physics step.
 */
export class Keyboard {
  private readonly down = new Set<string>();
  private pendingShift: -1 | 0 | 1 = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!e.repeat && e.code === 'KeyE') this.pendingShift = 1;
      if (!e.repeat && e.code === 'KeyQ') this.pendingShift = -1;
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** The shift requested since the last call, if any; clears it. */
  takeShift(): -1 | 0 | 1 {
    const shift = this.pendingShift;
    this.pendingShift = 0;
    return shift;
  }

  /** Pedals and steering now. `shift` is always 0 here: use `takeShift` for the step that runs. */
  controls(): Controls {
    const left = this.any('KeyA', 'ArrowLeft');
    const right = this.any('KeyD', 'ArrowRight');
    return {
      throttle: this.any('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.any('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      clutch: 0,
      shift: 0,
      handbrake: this.any('Space') ? 1 : 0,
    };
  }
}
