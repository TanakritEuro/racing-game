// The garage: a car's setup in clicks, a row per setting (−, where it sits between its two
// extremes, +), and what the setup does in numbers (balance, downforce, top speed, brake
// bias) against the car as designed, updated with every click. Plain DOM in the menus'
// style; it hands the setup back through its callbacks and never touches the game.

import { TUNING } from '../config';
import type { CarDef } from '../vehicle/carDef';
import { applySetup, cleanSetup, settingsFor, setupReadout, type Setup, type SetupReadout } from '../vehicle/setup';
import { button, div } from './menu';

export interface GarageOpen {
  car: CarDef;
  circuitName: string;
  setup: Setup;
  /** The setup of this car's best lap here, when there is one (it may arrive later). */
  best: Promise<Setup | null>;
  /** A line under the title (how the setup takes effect). */
  note: string;
  onDone(setup: Setup): void;
  onCancel(): void;
}

export class Garage {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private current: GarageOpen | null = null;
  private setup: Setup = {};
  private readonly refresh: (() => void)[] = [];

  constructor(parent: HTMLElement) {
    this.root = div(parent, 'menu-root hidden');
    this.panel = div(this.root, 'menu garage');
    // Keys pressed here are for the garage, not the car (Esc is handled by the game: cancel).
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(options: GarageOpen): void {
    this.current = options;
    this.setup = cleanSetup(options.setup);
    this.build(options);
    this.root.classList.remove('hidden');
    this.update();
  }

  /** Close without keeping the changes. */
  cancel(): void {
    if (!this.current) return;
    const { onCancel } = this.current;
    this.close();
    onCancel();
  }

  private close(): void {
    this.root.classList.add('hidden');
    this.current = null;
  }

  private build(o: GarageOpen): void {
    const C = TUNING.setup.clicks;
    this.panel.replaceChildren();
    this.refresh.length = 0;
    div(this.panel, 'menu-title', 'Setup');
    div(this.panel, 'garage-sub', `${o.car.name} · ${o.circuitName}`);
    div(this.panel, 'menu-help', o.note);

    // What the setup does, against the car as designed.
    const stock = setupReadout(o.car);
    const figures = div(this.panel, 'garage-readout');
    const figure = (label: string, value: (r: SetupReadout) => number, text: (v: number) => string, hint: string) => {
      const box = div(figures, 'garage-figure');
      div(box, 'garage-figure-label', label);
      const now = div(box, 'garage-figure-value');
      const was = div(box, 'garage-figure-stock');
      box.title = hint;
      this.refresh.push(() => {
        const v = value(setupReadout(applySetup(o.car, this.setup)));
        const s = value(stock);
        now.textContent = text(v);
        const same = Math.abs(v - s) < 1e-9;
        was.textContent = same ? 'as designed' : `was ${text(s)}`;
        box.classList.toggle('changed', !same);
      });
    };
    figure('Balance', (r) => r.frontRollShare, (v) => `${(v * 100).toFixed(1)} % front`, 'The front axle’s share of the roll stiffness: more is more understeer.');
    figure('Downforce at 200 km/h', (r) => r.downforce200, (v) => `${Math.round(v)} N`, 'Grip in fast corners, paid for in drag.');
    figure('Top speed', (r) => r.topSpeed, (v) => `${Math.round(v * 3.6)} km/h`, 'On a long straight, from the power, drag and gearing.');
    figure('Brake bias', (r) => r.brakeBias, (v) => `${Math.round(v * 100)} % front`, 'The front brakes’ share: rearward rotates the car, and can spin it.');
    if (stock.centreSplit !== null) {
      figure('Drive split', (r) => r.centreSplit ?? 0, (v) => `${Math.round(v * 100)} : ${Math.round((1 - v) * 100)}`, 'Front : rear share of the drive. More to the rear turns the car on the power.');
    }

    // A row per setting, in groups.
    let group = '';
    for (const s of settingsFor(o.car)) {
      if (s.group !== group) {
        group = s.group;
        div(this.panel, 'garage-group', group);
      }
      const row = div(this.panel, 'garage-row');
      const name = div(row, 'garage-label');
      div(name, 'garage-name', s.label);
      div(name, 'garage-more', `+ ${s.more}`);
      const minus = button(row, '−', 'garage-step');
      div(row, 'garage-end', s.low);
      const ticks = div(row, 'garage-ticks');
      const marks = Array.from({ length: 2 * C + 1 }, (_, i) => {
        const t = div(ticks, i === C ? 'garage-tick zero' : 'garage-tick');
        t.addEventListener('click', () => this.set(s.id, i - C));
        return t;
      });
      div(row, 'garage-end', s.high);
      const plus = button(row, '+', 'garage-step');
      const value = div(row, 'garage-value');
      minus.addEventListener('click', () => this.set(s.id, (this.setup[s.id] ?? 0) - 1));
      plus.addEventListener('click', () => this.set(s.id, (this.setup[s.id] ?? 0) + 1));
      this.refresh.push(() => {
        const v = this.setup[s.id] ?? 0;
        marks.forEach((m, i) => m.classList.toggle('on', i - C === v));
        value.textContent = v === 0 ? '0' : v > 0 ? `+${v}` : `−${-v}`;
        minus.disabled = v <= -C;
        plus.disabled = v >= C;
      });
    }

    const buttons = div(this.panel, 'menu-row');
    const done = button(buttons, 'Done', 'menu-go');
    done.addEventListener('click', () => {
      const { onDone } = o;
      const setup = cleanSetup(this.setup);
      this.close();
      onDone(setup);
    });
    button(buttons, 'Reset to as designed').addEventListener('click', () => {
      this.setup = {};
      this.update();
    });
    const best = button(buttons, 'Best lap’s setup');
    best.classList.add('hidden');
    void o.best.then((setup) => {
      if (!setup || this.current !== o) return;
      best.classList.remove('hidden');
      best.addEventListener('click', () => {
        this.setup = cleanSetup(setup);
        this.update();
      });
    });
    button(buttons, 'Cancel').addEventListener('click', () => this.cancel());
  }

  private set(id: keyof Setup, clicks: number): void {
    this.setup = cleanSetup({ ...this.setup, [id]: clicks });
    this.update();
  }

  private update(): void {
    for (const f of this.refresh) f();
  }
}
