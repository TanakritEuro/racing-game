// The editor's map: the circuit from above as it will be built (run-off, road, kerbs, the
// pit lane, the start line and which way it runs) over a metre grid, its control points as
// handles, and the problems marked in red. Drag a handle to move it, click the road (or near
// it) to add a point, drag empty ground to pan, wheel to zoom.

import { barrierOffset } from '../track/geometry';
import { laneEdges, pitLane } from '../track/pitLane';
import type { Track } from '../track/track';
import type { Problem } from '../track/validate';
import type { ControlPoint } from '../track/track';

export interface MapEvents {
  /** A handle was picked (null: none). */
  select(index: number | null): void;
  /** A drag of handle `index` started, moved it to (x, z), and ended. */
  dragStart(index: number): void;
  drag(index: number, x: number, z: number): void;
  dragEnd(index: number): void;
  /** A click on the ground away from any handle, at (x, z). */
  click(x: number, z: number): void;
}

/** Handles are this big on screen (px), and a click this close to one picks it. */
const HANDLE = 7;
const PICK = 12;

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** The view: world point at the centre, pixels per metre. */
  private cx = 0;
  private cz = 0;
  private scale = 0.6;
  private points: readonly ControlPoint[] = [];
  private track: Track | null = null;
  private problems: readonly Problem[] = [];
  private selected: number | null = null;
  private dragging: { kind: 'handle'; index: number } | { kind: 'pan'; x: number; y: number; moved: boolean } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly events: MapEvents,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'editor-map';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  /** What to draw: the control points, the circuit built from them (null while it can't be), its problems, the selection. */
  set(points: readonly ControlPoint[], track: Track | null, problems: readonly Problem[], selected: number | null): void {
    this.points = points;
    this.track = track;
    this.problems = problems;
    this.selected = selected;
    this.draw();
  }

  /** Look at world point (x, z). */
  centreOn(x: number, z: number): void {
    this.cx = x;
    this.cz = z;
    this.scale = Math.max(this.scale, 1);
    this.draw();
  }

  /** Fit the whole circuit in view. */
  fit(): void {
    const pts = this.points;
    if (pts.length === 0) return;
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const w = Math.max(100, Math.max(...xs) - Math.min(...xs));
    const h = Math.max(100, Math.max(...zs) - Math.min(...zs));
    this.cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    this.cz = (Math.max(...zs) + Math.min(...zs)) / 2;
    const r = this.canvas.getBoundingClientRect();
    this.scale = Math.min((r.width || 800) / (w + 160), (r.height || 600) / (h + 160));
    this.draw();
  }

  private toScreen(x: number, z: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(x - this.cx) * this.scale + r.width / 2, (z - this.cz) * this.scale + r.height / 2];
  }

  private toWorld(sx: number, sy: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(sx - r.width / 2) / this.scale + this.cx, (sy - r.height / 2) / this.scale + this.cz];
  }

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private handleAt(sx: number, sy: number): number | null {
    let best: number | null = null;
    let bestD = PICK;
    this.points.forEach((p, i) => {
      const [x, y] = this.toScreen(p.x, p.z);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private down(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = this.local(e);
    const h = e.button === 0 ? this.handleAt(sx, sy) : null;
    if (h !== null) {
      this.dragging = { kind: 'handle', index: h };
      this.events.select(h);
      this.events.dragStart(h);
    } else this.dragging = { kind: 'pan', x: sx, y: sy, moved: false };
  }

  private move(e: PointerEvent): void {
    const d = this.dragging;
    if (!d) {
      const [sx, sy] = this.local(e);
      this.canvas.style.cursor = this.handleAt(sx, sy) !== null ? 'grab' : 'crosshair';
      return;
    }
    const [sx, sy] = this.local(e);
    if (d.kind === 'handle') {
      const [x, z] = this.toWorld(sx, sy);
      this.events.drag(d.index, Math.round(x), Math.round(z));
    } else {
      if (Math.hypot(sx - d.x, sy - d.y) > 3) d.moved = true;
      this.cx -= (sx - d.x) / this.scale;
      this.cz -= (sy - d.y) / this.scale;
      d.x = sx;
      d.y = sy;
      this.draw();
    }
  }

  private up(e: PointerEvent): void {
    const d = this.dragging;
    this.dragging = null;
    if (!d) return;
    if (d.kind === 'handle') this.events.dragEnd(d.index);
    else if (!d.moved && e.button === 0) {
      const [sx, sy] = this.local(e);
      const [x, z] = this.toWorld(sx, sy);
      this.events.click(Math.round(x), Math.round(z));
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const [sx, sy] = this.local(e);
    const [wx, wz] = this.toWorld(sx, sy);
    this.scale = Math.min(8, Math.max(0.05, this.scale * Math.exp(-e.deltaY * 0.0015)));
    // Keep the point under the cursor where it is.
    const [nx, nz] = this.toWorld(sx, sy);
    this.cx += wx - nx;
    this.cz += wz - nz;
    this.draw();
  }

  draw(): void {
    const { canvas, ctx } = this;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#4f7a3a';
    ctx.fillRect(0, 0, r.width, r.height);
    this.drawGrid(r.width, r.height);
    const track = this.track;
    if (track) this.drawTrack(track);
    else this.drawOutline();
    this.drawHandles();
    if (track) this.drawProblems(track);
  }

  private drawGrid(w: number, h: number): void {
    const { ctx } = this;
    // Lines every 50 m (every 250 m stronger), thinned out when zoomed far out.
    const step = this.scale < 0.15 ? 250 : 50;
    const [x0, z0] = this.toWorld(0, 0);
    const [x1, z1] = this.toWorld(w, h);
    ctx.lineWidth = 1;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.toScreen(x, 0);
      ctx.strokeStyle = x % 250 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
    }
    for (let z = Math.floor(z0 / step) * step; z <= z1; z += step) {
      const [, sy] = this.toScreen(0, z);
      ctx.strokeStyle = z % 250 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
    }
  }

  /** A line through the samples at `offset(i)` (m left of the centreline), as a path. */
  private pathAlong(track: Track, offset: (i: number) => number, from = 0, to = track.samples.length, closed = true): void {
    const { ctx } = this;
    const { samples } = track;
    const n = samples.length;
    ctx.beginPath();
    for (let k = from; k <= (closed ? to : to - 1); k++) {
      const i = k % n;
      const p = samples[i];
      const o = offset(i);
      const [x, y] = this.toScreen(p.x + p.nx * o, p.z + p.nz * o);
      if (k === from) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private drawTrack(track: Track): void {
    const { ctx } = this;
    const { samples } = track;
    const n = samples.length;
    const s = this.scale;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Run-off to the barriers on each side (lighter grass), as a wide band per side.
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      for (let i = 0; i < n; i += 2) {
        const p = samples[i];
        const reach = barrierOffset(p, side);
        const mid = sign * (p.halfWidth + reach) / 2;
        const q = samples[(i + 2) % n];
        const [ax, ay] = this.toScreen(p.x + p.nx * mid, p.z + p.nz * mid);
        const [bx, by] = this.toScreen(q.x + q.nx * mid, q.z + q.nz * mid);
        ctx.strokeStyle = p[side].runoffSurface === 'gravel' ? '#c7b48a' : '#6b9a4f';
        ctx.lineWidth = Math.max(1, (reach - p.halfWidth) * s);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    // Barriers.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      this.pathAlong(track, (i) => sign * barrierOffset(samples[i], side));
      ctx.stroke();
    }
    // The pit lane.
    const lane = pitLane(track);
    if (lane) {
      ctx.strokeStyle = '#3c3f44';
      for (let i = lane.first; i !== lane.last; i = (i + 1) % n) {
        const e = laneEdges(track, lane, i);
        const q = laneEdges(track, lane, (i + 1) % n);
        if (!e || !q) continue;
        const p = samples[i];
        const p2 = samples[(i + 1) % n];
        const a = lane.sign * (p.halfWidth + (e[0] + e[1]) / 2);
        const b = lane.sign * (p2.halfWidth + (q[0] + q[1]) / 2);
        const [ax, ay] = this.toScreen(p.x + p.nx * a, p.z + p.nz * a);
        const [bx, by] = this.toScreen(p2.x + p2.nx * b, p2.z + p2.nz * b);
        ctx.lineWidth = Math.max(1, (e[1] - e[0]) * s);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    // The road, its width following each sample's.
    ctx.strokeStyle = '#2b2e33';
    for (let i = 0; i < n; i++) {
      const p = samples[i];
      const q = samples[(i + 1) % n];
      const [ax, ay] = this.toScreen(p.x, p.z);
      const [bx, by] = this.toScreen(q.x, q.z);
      ctx.lineWidth = Math.max(2, 2 * p.halfWidth * s);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    // Kerbs: red along the road edge where there are any.
    ctx.strokeStyle = '#d8342c';
    ctx.lineWidth = Math.max(1.5, 1.2 * s);
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      for (let i = 0; i < n; i++) {
        if (samples[i][side].kerb <= 0) continue;
        const p = samples[i];
        const q = samples[(i + 1) % n];
        const a = sign * (p.halfWidth + 0.5);
        const [ax, ay] = this.toScreen(p.x + p.nx * a, p.z + p.nz * a);
        const [bx, by] = this.toScreen(q.x + q.nx * a, q.z + q.nz * a);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    // The start line and an arrow the way the circuit runs.
    const p0 = samples[0];
    const [lx, ly] = this.toScreen(p0.x + p0.nx * p0.halfWidth, p0.z + p0.nz * p0.halfWidth);
    const [rx, ry] = this.toScreen(p0.x - p0.nx * p0.halfWidth, p0.z - p0.nz * p0.halfWidth);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = Math.round(n / 12); i < n; i += Math.round(n / 6)) this.arrow(track, i);
  }

  /** A small chevron on the road at sample `i`, pointing the way the circuit runs. */
  private arrow(track: Track, i: number): void {
    const { ctx } = this;
    const p = track.samples[i];
    const size = Math.max(4, Math.min(10, p.halfWidth * this.scale * 0.8));
    const [x, y] = this.toScreen(p.x, p.z);
    const a = Math.atan2(p.tz, p.tx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, size * 0.7);
    ctx.lineTo(-size * 0.6, -size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Without a built circuit (too few points): just the loop through the points. */
  private drawOutline(): void {
    const { ctx } = this;
    ctx.strokeStyle = '#2b2e33';
    ctx.lineWidth = 3;
    ctx.beginPath();
    this.points.forEach((p, i) => {
      const [x, y] = this.toScreen(p.x, p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  private drawHandles(): void {
    const { ctx } = this;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.points.forEach((p, i) => {
      const [x, y] = this.toScreen(p.x, p.z);
      const selected = i === this.selected;
      // Colour by height: blue low, white level, brown high.
      const h = Math.max(-1, Math.min(1, (p.y ?? 0) / 20));
      ctx.fillStyle = h >= 0 ? `rgb(${230 - 70 * h},${230 - 110 * h},${230 - 170 * h})` : `rgb(${230 + 140 * h},${230 + 80 * h},255)`;
      ctx.strokeStyle = selected ? '#f0c419' : i === 0 ? '#ffffff' : '#111';
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.beginPath();
      ctx.arc(x, y, selected ? HANDLE + 2 : HANDLE, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.fillText(i === 0 ? 'S' : String(i), x, y + 0.5);
    });
  }

  private drawProblems(track: Track): void {
    const { ctx } = this;
    const n = track.samples.length;
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 3;
    for (const problem of this.problems) {
      for (const at of problem.at) {
        const p = track.samples[Math.round((at / track.length) * n) % n];
        const [x, y] = this.toScreen(p.x, p.z);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(12, 20 * this.scale), 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  }
}
