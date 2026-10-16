// The menus (after five-a-side's): a start menu (mode, circuit, car, and the race's
// difficulty, opponents and laps; online, host or join), a pause menu, and settings. Plain DOM over the canvas.
// Choices go out through `MenuEvents`; the menus never touch the game themselves.

import type { Difficulty } from '../ai/skill';
import { formatLapTime } from '../race/timing';
import { ROUNDS } from '../race/championship';
import type { Settings } from '../settings';
import { CONDITIONS, type Conditions } from '../track/weather';
import { WEAR_RATES, type WearRate } from '../vehicle/wear';

export type Mode = 'trial' | 'race' | 'season' | 'online';

/** A championship in progress, for the start menu. */
export interface SeasonInfo {
  /** The round to run next (1-based) and how many there are. */
  round: number;
  rounds: number;
  /** Your place and points so far. */
  position: number;
  points: number;
  difficulty: string;
  car: string;
}

export interface StartChoice {
  mode: Mode;
  track: string;
  car: string;
  difficulty: Difficulty;
  opponents: number;
  laps: number;
  /** The weather (time trial, race, hosting online). */
  weather: Conditions;
  /** Tyre wear in a race (or hosting online). */
  wear: WearRate;
  /** Online: host a race or join one, and the room code to join. */
  online: 'host' | 'join';
  code: string;
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
  /** Carry on with the saved championship. */
  onContinueSeason(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  /** A setting changed (already written into the settings object). */
  onSettings(): void;
  /** Open the garage: for the circuit and car picked in the start menu, or (null) the car being driven. */
  onGarage(choice: { track: string; car: string; weather: Conditions } | null): void;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
/** None: online only (the two of you). */
const OPPONENTS = [0, 1, 3, 5, 7];
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
  private bestFor: (track: string, car: string, weather: Conditions) => number | null = () => null;
  private season: SeasonInfo | null = null;
  private readonly restartButton: HTMLButtonElement;
  private readonly quitButton: HTMLButtonElement;
  private readonly pauseSetup: HTMLButtonElement;

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
    this.choiceButton(modeRow, 'Championship', () => choice.mode === 'season', () => (choice.mode = 'season'));
    this.choiceButton(modeRow, 'Online', () => choice.mode === 'online', () => (choice.mode = 'online'));

    // Online: host (pick the circuit and laps, get a code) or join (type the code).
    const onlineRows = div(this.start, 'menu-group');
    const roleRow = this.row(onlineRows, 'Online');
    this.choiceButton(roleRow, 'Host a race', () => choice.online === 'host', () => (choice.online = 'host'));
    this.choiceButton(roleRow, 'Join a race', () => choice.online === 'join', () => (choice.online = 'join'));
    const codeRow = this.row(onlineRows, 'Room code');
    const code = document.createElement('input');
    code.className = 'menu-code';
    code.maxLength = 4;
    code.placeholder = 'ABCD';
    code.autocomplete = 'off';
    code.spellcheck = false;
    codeRow.appendChild(code);
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      choice.code = code.value;
      this.update();
    });
    const onlineHelp = div(onlineRows, 'menu-help');
    this.refresh.push(() => {
      onlineRows.classList.toggle('hidden', choice.mode !== 'online');
      codeRow.parentElement!.classList.toggle('hidden', choice.online !== 'join');
      if (code.value !== choice.code) code.value = choice.code;
      onlineHelp.textContent =
        choice.online === 'host'
          ? 'Pick the circuit, the laps, any AI opponents and your car; you get a four-character code to give the other player.'
          : 'Type the code the host gave you and pick your car; the host picks the circuit, the laps and the field.';
    });

    const circuitRow = this.row(this.start, 'Circuit');
    circuitRow.classList.add('menu-cards');
    for (const c of circuits) {
      const b = this.choiceButton(circuitRow, '', () => choice.track === c.id, () => (choice.track = c.id));
      b.classList.add('menu-card');
      b.appendChild(outline(c.outline));
      div(b, 'menu-card-name', c.name);
      div(b, 'menu-card-sub', `${c.length.toFixed(1)} km · ${c.blurb}`);
      const best = div(b, 'menu-card-sub');
      this.refresh.push(() => {
        const t = this.bestFor(c.id, choice.car, choice.weather);
        best.textContent = t === null ? 'No best yet' : `Best ${formatLapTime(t)}`;
      });
    }
    // A championship visits every circuit, and an online host picks for both: no picking one.
    this.refresh.push(() => circuitRow.parentElement!.classList.toggle('hidden', choice.mode === 'season' || (choice.mode === 'online' && choice.online === 'join')));
    const seasonInfo = div(this.start, 'menu-help');
    seasonInfo.textContent = `Four rounds against the same seven drivers: ${seasonRounds(circuits)}. Points for the top eight: 10, 8, 6, 5, 4, 3, 2, 1.`;
    this.refresh.push(() => seasonInfo.classList.toggle('hidden', choice.mode !== 'season'));

    const carRow = this.row(this.start, 'Car');
    carRow.classList.add('menu-cards');
    for (const car of cars) {
      const b = this.choiceButton(carRow, '', () => choice.car === car.name, () => (choice.car = car.name));
      b.classList.add('menu-card');
      div(b, 'menu-card-name', car.name);
      div(b, 'menu-card-sub', car.blurb);
      div(b, 'menu-card-sub', `${Math.round(car.power)} kW · ${car.mass} kg`);
    }

    // The weather: a championship draws its own each round; a guest online gets the host's.
    const weatherRow = this.row(this.start, 'Weather');
    for (const w of CONDITIONS) this.choiceButton(weatherRow, cap(w), () => choice.weather === w, () => (choice.weather = w));
    this.refresh.push(() => weatherRow.parentElement!.classList.toggle('hidden', choice.mode === 'season' || (choice.mode === 'online' && choice.online === 'join')));

    const raceRows = div(this.start, 'menu-group');
    const diffRow = this.row(raceRows, 'Difficulty');
    for (const d of DIFFICULTIES) this.choiceButton(diffRow, cap(d), () => choice.difficulty === d, () => (choice.difficulty = d));
    const oppRow = this.row(raceRows, 'Opponents');
    for (const n of OPPONENTS) {
      const b = this.choiceButton(oppRow, n === 0 ? 'None' : String(n), () => choice.opponents === n, () => (choice.opponents = n));
      if (n === 0) this.refresh.push(() => b.classList.toggle('hidden', choice.mode !== 'online'));
    }
    const lapRow = this.row(raceRows, 'Laps');
    for (const n of LAPS) this.choiceButton(lapRow, String(n), () => choice.laps === n, () => (choice.laps = n));
    const wearRow = this.row(raceRows, 'Tyre wear');
    for (const w of WEAR_RATES) this.choiceButton(wearRow, cap(w), () => choice.wear === w, () => (choice.wear = w));
    this.refresh.push(() => {
      const hosting = choice.mode === 'online' && choice.online === 'host';
      raceRows.classList.toggle('hidden', choice.mode === 'trial' || (choice.mode === 'online' && !hosting));
      // A championship sets its own field and laps; online the host sets them.
      oppRow.parentElement!.classList.toggle('hidden', choice.mode !== 'race' && !hosting);
      lapRow.parentElement!.classList.toggle('hidden', choice.mode !== 'race' && !hosting);
      wearRow.parentElement!.classList.toggle('hidden', choice.mode !== 'race' && !hosting);
    });

    const go = div(this.start, 'menu-row');
    const cont = button(go, '', 'menu-go');
    cont.addEventListener('click', () => events.onContinueSeason());
    const start = button(go, 'Start', 'menu-go');
    start.addEventListener('click', () => events.onStart({ ...choice }));
    this.refresh.push(() => {
      const s = this.season;
      const continuing = choice.mode === 'season' && s !== null;
      cont.classList.toggle('hidden', !continuing);
      if (s) cont.textContent = `Continue: round ${s.round} of ${s.rounds} · P${s.position}, ${s.points} pts`;
      const online = choice.mode === 'online';
      start.textContent = continuing ? 'New championship' : online ? (choice.online === 'host' ? 'Host' : 'Join') : 'Start';
      start.classList.toggle('menu-go', !continuing);
      start.disabled = online && choice.online === 'join' && choice.code.length !== 4;
    });
    const setupButton = button(go, 'Car setup');
    setupButton.addEventListener('click', () => events.onGarage({ track: choice.track, car: choice.car, weather: choice.weather }));
    // A championship visits every circuit, and a guest online doesn't know the circuit yet: set up from the pause menu.
    this.refresh.push(() => setupButton.classList.toggle('hidden', choice.mode === 'season' || (choice.mode === 'online' && choice.online === 'join')));
    button(go, 'Settings').addEventListener('click', () => this.showSettings(this.start));
    div(this.start, 'menu-help', KEYS);

    // Pause.
    div(this.pause, 'menu-title', 'Paused');
    const pauseRow = div(this.pause, 'menu-row');
    button(pauseRow, 'Resume', 'menu-go').addEventListener('click', () => events.onResume());
    this.restartButton = button(pauseRow, 'Restart');
    this.restartButton.addEventListener('click', () => events.onRestart());
    this.pauseSetup = button(pauseRow, 'Car setup');
    this.pauseSetup.addEventListener('click', () => events.onGarage(null));
    button(pauseRow, 'Settings').addEventListener('click', () => this.showSettings(this.pause));
    this.quitButton = button(pauseRow, 'Quit to menu');
    this.quitButton.addEventListener('click', () => events.onQuit());
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

  /** An online race: the pause menu can't restart it, and quitting leaves it. */
  setOnline(): void {
    this.restartButton.classList.add('hidden');
    this.pauseSetup.classList.add('hidden');
    this.quitButton.textContent = 'Leave race';
  }

  /** Whether the pause menu offers the garage (not once a championship round has counted). */
  allowSetup(allowed: boolean): void {
    this.pauseSetup.classList.toggle('hidden', !allowed);
  }

  /** The championship in progress, if any (for Continue). */
  setSeason(info: SeasonInfo | null): void {
    this.season = info;
    this.update();
  }

  /** The best lap for each circuit and car, shown on the circuit cards. */
  setBests(bestFor: (track: string, car: string, weather: Conditions) => number | null): void {
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

/**
 * A circuit's outline as a small SVG: vector, so it stays crisp at any pixel ratio. (Drawn on
 * a small canvas, the dense centreline came out broken and scribbled in Chrome.)
 */
function outline(points: readonly { x: number; z: number }[]): SVGSVGElement {
  const size = 96;
  const pad = 7;
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
  const scale = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (size - (maxX - minX) * scale) / 2;
  const oz = (size - (maxZ - minZ) * scale) / 2;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(ox + (p.x - minX) * scale).toFixed(1)} ${(oz + (p.z - minZ) * scale).toFixed(1)}`).join(' ') + ' Z';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.classList.add('menu-outline');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
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

/** "Proving Ground (5 laps), Saltmarsh (3), …" */
function seasonRounds(circuits: readonly CircuitInfo[]): string {
  const name = (id: string) => circuits.find((c) => c.id === id)?.name ?? id;
  return ROUNDS.map((r, i) => `${name(r.track)} (${r.laps}${i === 0 ? ' laps' : ''})`).join(', ');
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
