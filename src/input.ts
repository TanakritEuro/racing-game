import type { Controls } from './vehicle/car';

/**
 * Keyboard → Controls. Keys are digital, so steering is smoothed inside the car's
 * simulation (`TUNING.steering`); analogue gamepad input comes in Milestone 2.
 */
export class Keyboard {
  private readonly down = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  controls(): Controls {
    const left = this.any('KeyA', 'ArrowLeft');
    const right = this.any('KeyD', 'ArrowRight');
    return {
      throttle: this.any('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.any('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      clutch: 0,
      shift: 0,
    };
  }
}
