// The menus (after five-a-side's): a start menu (mode, circuit, car, and the race's
// difficulty, opponents and laps), a pause menu, and settings. Plain DOM over the canvas.
// Choices go out through `MenuEvents`; the menus never touch the game themselves.

import type { Difficulty } from '../ai/skill';
import { formatLapTime } from '../race/timing';
import type { Settings } from '../settings';

export type Mode = 'trial' | 'race';

export interface StartChoice {
  mode: Mode;
  track: string;
  car: string;
  difficulty: Difficulty;
  opponents: number;
  laps: number;
}

export interface CircuitInfo {
  id: string;
  name: string;
  /** Length (km) and a few words about it. */
  length: number;
  blurb: string;
  /** The centreline's shape, for a thumbnail. */
  outline: { x: number; z: number }[];
}

export interface CarInfo {
  name: string;
  blurb: string;
  /** Peak power (kW), mass (kg). */
  power: number;
  mass: number;
}

export interface MenuEvents {
  onStart(choice: StartChoice): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  /** A setting changed (already written into the settings object). */
  onSettings(): void;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const OPPONENTS = [1, 3, 5, 7];
const LAPS = [1, 3, 5, 10];

/** Every key, for the start and pause menus. */
export const KEYS =
  'W/S or ↑/↓ throttle and brake · A/D or ←/→ steer · Space handbrake · E/Q shift · M auto/manual · Z ABS · X TC · V steering assist · C camera · R back on the track · ⌫ restart · G ghost · P replay (⇧P best) · U sound · T telemetry · Esc pause';

export class Menu {
  private readonly root: HTMLElement;
  private readonly start: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly settingsPanel: HTMLElement;
  private readonly refresh: (() => void)[] = [];
  /** Where Back from settings goes. */
  private settingsFrom: HTMLElement;
  private bestFor: (track: string, car: string) => number | null = () => null;

  constructor(
    parent: HTMLElement,
    private readonly events: MenuEvents,
    choice: StartChoice,
    circuits: readonly CircuitInfo[],
    cars: readonly CarInfo[],
    settings: Settings,
  ) {
    this.root = div(parent, 'menu-root hidden');
    this.start = div(this.root, 'menu');
    this.pause = div(this.root, 'menu hidden');
    this.settingsPanel = div(this.root, 'menu hidden');
    this.settingsFrom = this.start;

    // Start.
    div(this.start, 'menu-title', 'RACING');
    const modeRow = this.row(this.start, 'Mode');
    this.choiceButton(modeRow, 'Time trial', () => choice.mode === 'trial', () => (choice.mode = 'trial'));
    this.choiceButton(modeRow, 'Race', () => choice.mode === 'race', () => (choice.mode = 'race'));

    const circuitRow = this.row(this.start, 'Circuit');
    circuitRow.classList.add('menu-cards');
    for (const c of circuits) {
      const b = this.choiceButton(circuitRow, '', () => choice.track === c.id, () => (choice.track = c.id));
      b.classList.add('menu-card');
      const thumb = document.createElement('canvas');
      drawOutline(thumb, c.outline);
      b.appendChild(thumb);
      div(b, 'menu-card-name', c.name);
      div(b, 'menu-card-sub', `${c.length.toFixed(1)} km · ${c.blurb}`);
      const best = div(b, 'menu-card-sub');
      this.refresh.push(() => {
        const t = this.bestFor(c.id, choice.car);
        best.textContent = t === null ? 'No best yet' : `Best ${formatLapTime(t)}`;
      });
    }

    const carRow = this.row(this.start, 'Car');
    carRow.classList.add('menu-cards');
    for (const car of cars) {
      const b = this.choiceButton(carRow, '', () => choice.car === car.name, () => (choice.car = car.name));
      b.classList.add('menu-card');
      div(b, 'menu-card-name', car.name);
      div(b, 'menu-card-sub', car.blurb);
      div(b, 'menu-card-sub', `${Math.round(car.power)} kW · ${car.mass} kg`);
    }

    const raceRows = div(this.start, 'menu-group');
    const diffRow = this.row(raceRows, 'Difficulty');
    for (const d of DIFFICULTIES) this.choiceButton(diffRow, cap(d), () => choice.difficulty === d, () => (choice.difficulty = d));
    const oppRow = this.row(raceRows, 'Opponents');
    for (const n of OPPONENTS) this.choiceButton(oppRow, String(n), () => choice.opponents === n, () => (choice.opponents = n));
    const lapRow = this.row(raceRows, 'Laps');
    for (const n of LAPS) this.choiceButton(lapRow, String(n), () => choice.laps === n, () => (choice.laps = n));
    this.refresh.push(() => raceRows.classList.toggle('hidden', choice.mode !== 'race'));

    const go = div(this.start, 'menu-row');
    button(go, 'Start', 'menu-go').addEventListener('click', () => events.onStart({ ...choice }));
    button(go, 'Settings').addEventListener('click', () => this.showSettings(this.start));
    div(this.start, 'menu-help', KEYS);

    // Pause.
    div(this.pause, 'menu-title', 'Paused');
    const pauseRow = div(this.pause, 'menu-row');
    button(pauseRow, 'Resume', 'menu-go').addEventListener('click', () => events.onResume());
    button(pauseRow, 'Restart').addEventListener('click', () => events.onRestart());
    button(pauseRow, 'Settings').addEventListener('click', () => this.showSettings(this.pause));
    button(pauseRow, 'Quit to menu').addEventListener('click', () => events.onQuit());
    div(this.pause, 'menu-help', KEYS);

    // Settings.
    div(this.settingsPanel, 'menu-title', 'Settings');
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const row = this.row(this.settingsPanel, label);
      this.choiceButton(row, 'On', () => get(), () => set(true), true);
      this.choiceButton(row, 'Off', () => !get(), () => set(false), true);
    };
    toggle('ABS', () => settings.abs, (v) => (settings.abs = v));
    toggle('Traction control', () => settings.tc, (v) => (settings.tc = v));
    toggle('Steering assist', () => settings.steeringAssist, (v) => (settings.steeringAssist = v));
    const gearRow = this.row(this.settingsPanel, 'Gearbox');
    this.choiceButton(gearRow, 'Automatic', () => settings.gearbox === 'auto', () => (settings.gearbox = 'auto'), true);
    this.choiceButton(gearRow, 'Manual', () => settings.gearbox === 'manual', () => (settings.gearbox = 'manual'), true);
    const camRow = this.row(this.settingsPanel, 'Camera');
    for (const [mode, label] of [
      ['chase', 'Chase'],
      ['bumper', 'Bumper'],
      ['hood', 'Hood'],
    ] as const) {
      this.choiceButton(camRow, label, () => settings.camera === mode, () => (settings.camera = mode), true);
    }
    toggle('Ghost', () => settings.ghost, (v) => (settings.ghost = v));
    toggle('Sound', () => !settings.muted, (v) => (settings.muted = !v));
    const volRow = this.row(this.settingsPanel, 'Volume');
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.05';
    volume.className = 'menu-slider';
    volRow.appendChild(volume);
    this.refresh.push(() => (volume.value = String(settings.volume)));
    volume.addEventListener('input', () => {
      settings.volume = Number(volume.value);
      events.onSettings();
    });
    const back = div(this.settingsPanel, 'menu-row');
    button(back, 'Back', 'menu-go').addEventListener('click', () => this.show(this.settingsFrom));

    // Keys pressed in a menu are for the menu, not the car.
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.update();
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Which panel is up: 'start', 'pause', 'settings', or null. */
  get panel(): 'start' | 'pause' | 'settings' | null {
    if (!this.open) return null;
    return !this.start.classList.contains('hidden') ? 'start' : !this.pause.classList.contains('hidden') ? 'pause' : 'settings';
  }

  /** The best lap for each circuit and car, shown on the circuit cards. */
  setBests(bestFor: (track: string, car: string) => number | null): void {
    this.bestFor = bestFor;
    this.update();
  }

  showStart(): void {
    this.show(this.start);
  }

  showPause(): void {
    this.show(this.pause);
  }

  showSettings(from: HTMLElement): void {
    this.settingsFrom = from;
    this.show(this.settingsPanel);
  }

  /** Back one level: settings → where it came from; pause → the game. Returns false at the start menu. */
  back(): boolean {
    const panel = this.panel;
    if (panel === 'settings') {
      this.show(this.settingsFrom);
      return true;
    }
    if (panel === 'pause') {
      this.events.onResume();
      return true;
    }
    return false;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private show(panel: HTMLElement): void {
    this.root.classList.remove('hidden');
    for (const p of [this.start, this.pause, this.settingsPanel]) p.classList.toggle('hidden', p !== panel);
    this.update();
  }

  private update(): void {
    for (const f of this.refresh) f();
  }

  /** A labelled row of choices. Returns the element the buttons go in. */
  private row(parent: HTMLElement, label: string): HTMLElement {
    const row = div(parent, 'menu-row');
    if (label) div(row, 'menu-label', label);
    return div(row, 'menu-choices');
  }

  /** A button that picks something; `setting`: tell the game straight away. */
  private choiceButton(parent: HTMLElement, label: string, selected: () => boolean, pick: () => void, setting = false): HTMLButtonElement {
    const b = button(parent, label);
    b.addEventListener('click', () => {
      pick();
      if (setting) this.events.onSettings();
      this.update();
    });
    this.refresh.push(() => b.classList.toggle('selected', selected()));
    return b;
  }
}

/** A circuit's outline, scaled to fit a small canvas. */
function drawOutline(canvas: HTMLCanvasElement, points: readonly { x: number; z: number }[]): void {
  const size = 96;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = size * ratio;
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const scale = ((size - 14) * ratio) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (size * ratio - (maxX - minX) * scale) / 2;
  const oz = (size * ratio - (maxZ - minZ) * scale) / 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const u = ox + (p.x - minX) * scale;
    const v = oz + (p.z - minZ) * scale;
    if (i === 0) ctx.moveTo(u, v);
    else ctx.lineTo(u, v);
  });
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * ratio;
  ctx.strokeStyle = '#f2f4f7';
  ctx.stroke();
}

export function div(parent: HTMLElement, className: string, text = ''): HTMLElement {
  const e = document.createElement('div');
  e.className = className;
  e.textContent = text;
  parent.appendChild(e);
  return e;
}

export function button(parent: HTMLElement, text: string, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = text;
  parent.appendChild(b);
  return b;
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
