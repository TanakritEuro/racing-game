// Telemetry overlay (`?telemetry`, or T to toggle): what each tyre is doing, plus the
// drivetrain, the driver's inputs and ten seconds of scrolling graphs. Most handling bugs
// are obvious here and invisible from the chase camera.
//
// Presentation only: it reads the simulation after each frame and never writes to it.

import type { Controls, Wheel } from '../vehicle/car';

/** What the overlay reads each frame. */
export interface TelemetryInput {
  time: number;
  /** Forward speed (m/s). */
  speed: number;
  wheels: readonly Wheel[];
  controls: Controls;
  /** Drivetrain readouts, once the car has one. */
  rpm?: number;
  gear?: string;
}

const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'];
const WHEEL_COLOURS = ['#4fc3f7', '#81c784', '#ffb74d', '#f06292'];
/** Seconds of history in the graphs. */
const HISTORY = 10;
/** Ring buffer length: enough for HISTORY seconds at 120 frames per second. */
const CAPACITY = 1280;
/** Text readouts change this often (Hz), so they stay readable. */
const TEXT_RATE = 12;

interface Graph {
  canvas: HTMLCanvasElement;
  label: string;
  /** Value range drawn, bottom to top. */
  min: number;
  max: number;
  /** Channels drawn on this graph: index into `channels` and colour. */
  lines: { channel: number; colour: string }[];
  /** Horizontal guide lines. */
  guides: number[];
}

// Channel layout in the ring buffer.
const CH_SPEED = 0;
const CH_RPM = 1;
const CH_KAPPA = 2; // 4 channels
const CH_ALPHA = 6; // 4 channels
const CHANNELS = 10;

export class Telemetry {
  readonly root: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly pedals: { el: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private readonly wheelText: HTMLPreElement[] = [];
  private readonly circles: HTMLCanvasElement[] = [];
  private readonly graphs: Graph[];
  private readonly times = new Float64Array(CAPACITY);
  private readonly channels: Float32Array[] = [];
  private head = 0;
  private count = 0;
  private lastText = -Infinity;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'telemetry');
    this.root.hidden = true;
    parent.appendChild(this.root);

    const top = el('div', 'tm-top', this.root);
    this.header = el('div', 'tm-header', top);
    const pedalBox = el('div', 'tm-pedals', top);
    for (const [name, colour] of [
      ['T', '#66bb6a'],
      ['B', '#ef5350'],
      ['C', '#90a4ae'],
      ['S', '#ffee58'],
    ]) {
      const p = el('div', 'tm-pedal', pedalBox);
      p.title = name;
      const fill = el('div', 'tm-fill', p);
      fill.style.background = colour;
      el('span', '', p).textContent = name;
      this.pedals.push({ el: p, fill });
    }

    const grid = el('div', 'tm-wheels', this.root);
    for (let i = 0; i < 4; i++) {
      const cell = el('div', 'tm-wheel', grid);
      const name = el('div', 'tm-name', cell);
      name.textContent = WHEEL_NAMES[i];
      name.style.color = WHEEL_COLOURS[i];
      const circle = el('canvas', 'tm-circle', cell);
      circle.width = circle.height = 64;
      this.circles.push(circle);
      this.wheelText.push(el('pre', 'tm-text', cell));
    }

    for (let c = 0; c < CHANNELS; c++) this.channels.push(new Float32Array(CAPACITY));
    const perWheel = (base: number) => WHEEL_COLOURS.map((colour, i) => ({ channel: base + i, colour }));
    this.graphs = [
      { label: 'speed km/h', min: 0, max: 260, lines: [{ channel: CH_SPEED, colour: '#ffffff' }], guides: [100, 200] },
      { label: 'rpm', min: 0, max: 8000, lines: [{ channel: CH_RPM, colour: '#ffca28' }], guides: [2000, 4000, 6000] },
      { label: 'slip ratio κ', min: -0.4, max: 0.4, lines: perWheel(CH_KAPPA), guides: [0, -0.1, 0.1] },
      { label: 'slip angle α °', min: -15, max: 15, lines: perWheel(CH_ALPHA), guides: [0, -7, 7] },
    ].map((g) => {
      const canvas = el('canvas', 'tm-graph', this.root);
      canvas.width = 360;
      canvas.height = 64;
      return { ...g, canvas };
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  /** Record this frame's sample; redraw when visible. */
  update(input: TelemetryInput): void {
    this.record(input);
    if (!this.visible) return;
    if (input.time - this.lastText >= 1 / TEXT_RATE || input.time < this.lastText) {
      this.lastText = input.time;
      this.drawText(input);
    }
    input.wheels.forEach((w, i) => drawCircle(this.circles[i], w, WHEEL_COLOURS[i]));
    for (const g of this.graphs) this.drawGraph(g, input.time);
  }

  private record(input: TelemetryInput): void {
    // A reset (time going backwards) starts the history again.
    if (this.count > 0 && input.time < this.times[(this.head - 1 + CAPACITY) % CAPACITY]) this.count = 0;
    const i = this.head;
    this.times[i] = input.time;
    const ch = this.channels;
    ch[CH_SPEED][i] = Math.abs(input.speed) * 3.6;
    ch[CH_RPM][i] = input.rpm ?? 0;
    input.wheels.forEach((w, k) => {
      ch[CH_KAPPA + k][i] = w.slipRatio;
      ch[CH_ALPHA + k][i] = (w.slipAngle * 180) / Math.PI;
    });
    this.head = (i + 1) % CAPACITY;
    this.count = Math.min(this.count + 1, CAPACITY);
  }

  private drawText(input: TelemetryInput): void {
    const kmh = Math.abs(input.speed) * 3.6;
    const rpm = input.rpm === undefined ? '—' : Math.round(input.rpm).toString();
    this.header.textContent = `${kmh.toFixed(1).padStart(5)} km/h   gear ${input.gear ?? '—'}   ${rpm} rpm`;
    const c = input.controls;
    [c.throttle, c.brake, c.clutch, Math.abs(c.steer)].forEach((v, i) => {
      this.pedals[i].fill.style.height = `${Math.round(v * 100)}%`;
    });
    input.wheels.forEach((w, i) => {
      const num = (v: number, digits = 0, width = 7) => (v >= 0 ? '+' : '') + v.toFixed(digits).padStart(width - 1);
      this.wheelText[i].textContent = [
        `Fz  ${w.load.toFixed(0).padStart(6)} N`,
        `κ  ${num(w.slipRatio, 3)}`,
        `α  ${num((w.slipAngle * 180) / Math.PI, 1)}°`,
        `Fx ${num(w.longForce)} N`,
        `Fy ${num(w.latForce)} N`,
        `ω  ${num(w.omega, 1)} r/s`,
        // Drive torque on the driven wheels (rear, front or all four).
        w.driven ? `Td ${num(w.driveTorque, 0, 6)}` : 'Td      —',
        `Tb ${w.brakeTorque.toFixed(0).padStart(5)}${w.absFactor < 1 ? ` abs ${w.absFactor.toFixed(2)}` : ''}`,
        w.contact ? (w.surface ?? '') : 'airborne',
      ].join('\n');
    });
  }

  private drawGraph(g: Graph, now: number): void {
    const ctx = g.canvas.getContext('2d')!;
    const { width: w, height: h } = g.canvas;
    ctx.clearRect(0, 0, w, h);
    const y = (v: number) => h - ((Math.min(Math.max(v, g.min), g.max) - g.min) / (g.max - g.min)) * h;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (const v of g.guides) {
      ctx.beginPath();
      ctx.moveTo(0, y(v));
      ctx.lineTo(w, y(v));
      ctx.stroke();
    }
    ctx.lineWidth = 1.5;
    for (const line of g.lines) {
      const data = this.channels[line.channel];
      ctx.strokeStyle = line.colour;
      ctx.beginPath();
      let started = false;
      for (let k = this.count; k >= 1; k--) {
        const i = (this.head - k + CAPACITY) % CAPACITY;
        const age = now - this.times[i];
        if (age > HISTORY) continue;
        const x = w - (age / HISTORY) * w;
        if (started) ctx.lineTo(x, y(data[i]));
        else ctx.moveTo(x, y(data[i]));
        started = true;
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(g.label, 4, 11);
  }
}

/** Friction circle: the ring is the grip limit; the dot is the force (up = forward, right = right). */
function drawCircle(canvas: HTMLCanvasElement, wheel: Wheel, colour: string): void {
  const ctx = canvas.getContext('2d')!;
  const s = canvas.width;
  const r = s / 2 - 4;
  ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
  ctx.moveTo(s / 2 - r, s / 2);
  ctx.lineTo(s / 2 + r, s / 2);
  ctx.moveTo(s / 2, s / 2 - r);
  ctx.lineTo(s / 2, s / 2 + r);
  ctx.stroke();
  if (wheel.gripLimit <= 0) return;
  const fx = (wheel.latForce / wheel.gripLimit) * r;
  const fy = (wheel.longForce / wheel.gripLimit) * r;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(s / 2 + fx, s / 2 - fy, 4, 0, Math.PI * 2);
  ctx.fill();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.appendChild(e);
  return e;
}
