// Minimap: the track's outline seen from above (north up), the start line, and the car.
// The outline is drawn once; each frame copies it and adds the car.

import type { CarPose } from '../vehicle/pose';
import type { Track } from '../track/track';

const SIZE = 180;
const PAD = 12;

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;
  private readonly toMap: (x: number, z: number) => [number, number];

  constructor(parent: HTMLElement, track: Track) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.canvas.width = this.canvas.height = SIZE * ratio;
    parent.appendChild(this.canvas);

    // Fit the track's bounds into the square, keeping its proportions.
    const xs = track.samples.map((p) => p.x);
    const zs = track.samples.map((p) => p.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const span = Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
    const scale = ((SIZE - 2 * PAD) * ratio) / span;
    const offX = (SIZE * ratio - (Math.max(...xs) - minX) * scale) / 2;
    const offZ = (SIZE * ratio - (Math.max(...zs) - minZ) * scale) / 2;
    this.toMap = (x, z) => [offX + (x - minX) * scale, offZ + (z - minZ) * scale];

    this.base = document.createElement('canvas');
    this.base.width = this.base.height = SIZE * ratio;
    const ctx = this.base.getContext('2d')!;
    ctx.lineJoin = ctx.lineCap = 'round';
    const outline = (width: number, colour: string) => {
      ctx.beginPath();
      track.samples.forEach((p, i) => {
        const [u, v] = this.toMap(p.x, p.z);
        if (i === 0) ctx.moveTo(u, v);
        else ctx.lineTo(u, v);
      });
      ctx.closePath();
      ctx.lineWidth = width * ratio;
      ctx.strokeStyle = colour;
      ctx.stroke();
    };
    outline(7, 'rgba(10, 14, 20, 0.75)');
    outline(3.5, '#e8edf2');
    // Start line: a short bar across the track.
    const s0 = track.samples[0];
    const [a, b] = [this.toMap(s0.x + s0.nx * 12, s0.z + s0.nz * 12), this.toMap(s0.x - s0.nx * 12, s0.z - s0.nz * 12)];
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineWidth = 2.5 * ratio;
    ctx.strokeStyle = '#ffca28';
    ctx.stroke();
  }

  update(pose: CarPose): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    const ratio = this.canvas.width / SIZE;
    const [u, v] = this.toMap(pose.position.x, pose.position.z);
    // Heading on the ground: the car's −Z.
    const q = pose.rotation;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const angle = Math.atan2(fz, fx);
    ctx.save();
    ctx.translate(u, v);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(7 * ratio, 0);
    ctx.lineTo(-4 * ratio, 4.5 * ratio);
    ctx.lineTo(-4 * ratio, -4.5 * ratio);
    ctx.closePath();
    ctx.fillStyle = '#e0b020';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5 * ratio;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
