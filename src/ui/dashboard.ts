// The dashboard: a rev counter drawn on a canvas (needle, the redline from the car's own
// limiter, shift lights from its upshift RPM), speed and gear in the middle, and the ABS / TC
// / assist lights beneath. Reads numbers it is given; never writes to the simulation.

export interface DashState {
  rpm: number;
  /** Speed shown (km/h) and the gear's label (R, N, 1…) with the gearbox mode. */
  speed: number;
  gear: string;
  mode: string;
  /** The car's limiter and upshift RPM. */
  limiter: number;
  upshift: number;
  /** Each aid: switched on, and working right now. */
  abs: [boolean, boolean];
  tc: [boolean, boolean];
  assist: boolean;
}

/** Size of the gauge (CSS px), its sweep (from 225° round to −45°), and the shift lights. */
const SIZE = 190;
const START = (225 * Math.PI) / 180;
const SWEEP = (270 * Math.PI) / 180;
const SHIFT_LIGHTS = 5;
/** The shift lights fill over this many RPM below the upshift point. */
const SHIFT_SPAN = 1500;
const SHIFT_COLOURS = ['#43d36b', '#43d36b', '#ffd23a', '#ff5a3c', '#ff5a3c'];

export class Dashboard {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lights: Record<'abs' | 'tc' | 'assist', HTMLSpanElement>;
  private flash = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gauge';
    this.canvas.style.width = this.canvas.style.height = `${SIZE}px`;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = SIZE * ratio;
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(ratio, ratio);
    const row = document.createElement('div');
    row.className = 'dash-lights';
    root.appendChild(row);
    const light = (text: string) => {
      const s = document.createElement('span');
      s.textContent = text;
      row.appendChild(s);
      return s;
    };
    this.lights = { abs: light('ABS'), tc: light('TC'), assist: light('ASSIST') };
  }

  update(s: DashState, dt: number): void {
    this.flash = (this.flash + dt) % 0.2;
    this.draw(s);
    const set = (el: HTMLElement, on: boolean, active: boolean) => {
      el.classList.toggle('on', on);
      el.classList.toggle('active', on && active);
    };
    set(this.lights.abs, s.abs[0], s.abs[1]);
    set(this.lights.tc, s.tc[0], s.tc[1]);
    set(this.lights.assist, s.assist, false);
  }

  private draw(s: DashState): void {
    const ctx = this.ctx;
    const c = SIZE / 2;
    const r = SIZE / 2 - 14;
    const max = Math.ceil(s.limiter / 1000) * 1000;
    const angle = (rpm: number) => START - SWEEP * Math.min(1, Math.max(0, rpm / max));
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Face.
    ctx.beginPath();
    ctx.arc(c, c, r + 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 14, 20, 0.72)';
    ctx.fill();

    // Redline: from the upshift point to the top of the scale.
    ctx.beginPath();
    ctx.arc(c, c, r - 3, -angle(s.upshift), -angle(max));
    ctx.strokeStyle = '#e53935';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Ticks every 500 RPM, numbers every 1000.
    ctx.fillStyle = '#e8edf2';
    ctx.strokeStyle = '#e8edf2';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let rpm = 0; rpm <= max; rpm += 500) {
      const a = angle(rpm);
      const major = rpm % 1000 === 0;
      const x = Math.cos(a);
      const y = -Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(c + x * r, c + y * r);
      ctx.lineTo(c + x * (r - (major ? 11 : 6)), c + y * (r - (major ? 11 : 6)));
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();
      if (major) ctx.fillText(String(rpm / 1000), c + x * (r - 22), c + y * (r - 22));
    }

    // Needle.
    const a = angle(s.rpm);
    ctx.beginPath();
    ctx.moveTo(c - Math.cos(a) * 10, c + Math.sin(a) * 10);
    ctx.lineTo(c + Math.cos(a) * (r - 6), c - Math.sin(a) * (r - 6));
    ctx.strokeStyle = '#ffb300';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(c, c, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffb300';
    ctx.fill();

    // Shift lights across the top: filling towards the upshift point, all flashing at the limiter.
    const lit = Math.max(0, Math.min(SHIFT_LIGHTS, ((s.rpm - (s.upshift - SHIFT_SPAN)) / SHIFT_SPAN) * SHIFT_LIGHTS));
    const limiting = s.rpm > s.limiter - 150;
    for (let i = 0; i < SHIFT_LIGHTS; i++) {
      const x = c + (i - (SHIFT_LIGHTS - 1) / 2) * 14;
      ctx.beginPath();
      ctx.arc(x, c - r * 0.42, 4.5, 0, Math.PI * 2);
      const on = limiting ? this.flash < 0.1 : i < lit;
      ctx.fillStyle = on ? (limiting ? '#4fc3ff' : SHIFT_COLOURS[i]) : 'rgba(255, 255, 255, 0.12)';
      ctx.fill();
    }

    // Speed and gear.
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 38px system-ui, sans-serif';
    ctx.fillText(String(Math.round(s.speed)), c, c + 22);
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.globalAlpha = 0.75;
    ctx.fillText('KM/H', c, c + 44);
    ctx.globalAlpha = 1;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText(s.gear, c, c - 24);
    ctx.font = '700 9px system-ui, sans-serif';
    ctx.globalAlpha = 0.6;
    ctx.fillText(s.mode, c, c + 64);
    ctx.globalAlpha = 1;
  }
}
