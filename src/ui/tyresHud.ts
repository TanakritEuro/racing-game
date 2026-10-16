// The tyre and fuel panel: each tyre's wear as a colour (green new, red worn) laid out as the
// car's four corners, the fuel aboard, the pit limiter light while it's on, and BOX when it's
// time to stop. Only shown when there's wear or fuel to show. Reads the car; never writes.

import type { PitState } from '../race/pits';
import type { Car } from '../vehicle/car';
import { div } from './menu';

export class TyresHud {
  private readonly panel: HTMLElement;
  private readonly tyres: HTMLElement[];
  private readonly fuel: HTMLElement;
  private readonly limiter: HTMLElement;
  private readonly box: HTMLElement;

  constructor(root: HTMLElement) {
    this.panel = div(root, 'tyres-panel hidden');
    const grid = div(this.panel, 'tyres-grid');
    this.tyres = Array.from({ length: 4 }, () => div(grid, 'tyre'));
    this.fuel = div(this.panel, 'tyres-fuel');
    this.limiter = div(this.panel, 'tyres-limiter', 'PIT LIMITER');
    this.box = div(this.panel, 'tyres-box', 'BOX');
  }

  /** Each frame: `pits` is the car's pit state (null without a pit lane); `boxNow` calls it in. */
  update(car: Car, pits: PitState | null, boxNow: boolean): void {
    const show = car.wearRate > 0 || car.fuel > 0;
    this.panel.classList.toggle('hidden', !show);
    if (!show) return;
    car.wheels.forEach((w, i) => {
      const el = this.tyres[i];
      const left = Math.max(0, 1 - w.wear);
      // Green to yellow to red as it wears; the number is what's left.
      el.style.background = `hsl(${Math.round(120 * Math.min(1, Math.max(0, (left - 0.1) / 0.8)))}, 70%, 42%)`;
      const text = `${Math.round(left * 100)}`;
      if (el.textContent !== text) el.textContent = text;
    });
    const fuel = car.fuel > 0 ? `FUEL ${car.fuel.toFixed(1)} kg` : '';
    if (this.fuel.textContent !== fuel) this.fuel.textContent = fuel;
    this.limiter.classList.toggle('on', pits?.limited ?? false);
    this.box.classList.toggle('on', boxNow && !(pits?.inLane ?? false));
  }
}
