// The editor's state: the circuit being drawn, the selected point, and undo / redo. Every
// change makes a new circuit (the old ones are the history). Pure: no DOM.

import type { CustomCircuit } from '../track/custom';
import type { ControlPoint } from '../track/track';

/** How many changes undo remembers. */
const HISTORY = 100;

export class EditorState {
  circuit: CustomCircuit;
  /** The selected control point, or null. */
  selected: number | null = null;
  private readonly past: CustomCircuit[] = [];
  private future: CustomCircuit[] = [];

  constructor(circuit: CustomCircuit) {
    this.circuit = structuredClone(circuit);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Change the circuit (a copy is passed to `change`); one step of undo. */
  apply(change: (c: CustomCircuit) => void): void {
    const next = structuredClone(this.circuit);
    change(next);
    if (JSON.stringify(next) === JSON.stringify(this.circuit)) return;
    this.past.push(this.circuit);
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
    this.circuit = next;
    this.fixSelection();
  }

  /** A change made in many small moves (a drag): `begin` once, then `live` changes, then `end`. */
  begin(): void {
    this.past.push(structuredClone(this.circuit));
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
  }
  live(change: (c: CustomCircuit) => void): void {
    change(this.circuit);
  }
  end(): void {
    // Nothing moved: no undo step.
    const before = this.past[this.past.length - 1];
    if (before && JSON.stringify(before) === JSON.stringify(this.circuit)) this.past.pop();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.circuit);
    this.circuit = prev;
    this.fixSelection();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.circuit);
    this.circuit = next;
    this.fixSelection();
  }

  /** Put a new point at (x, z) where it lengthens the loop least (between its two nearest neighbours along it); select it. */
  insertPoint(x: number, z: number): void {
    const pts = this.circuit.points;
    let best = 0;
    let cost = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const c = Math.hypot(x - a.x, z - a.z) + Math.hypot(x - b.x, z - b.z) - Math.hypot(b.x - a.x, b.z - a.z);
      if (c < cost) {
        cost = c;
        best = i;
      }
    }
    const a = pts[best];
    const b = pts[(best + 1) % pts.length];
    const point: ControlPoint = { x, z };
    // Height, banking and width between its neighbours'.
    const mid = (u?: number, v?: number) => ((u ?? 0) + (v ?? 0)) / 2;
    if (a.y !== undefined || b.y !== undefined) point.y = mid(a.y, b.y);
    if (a.width !== undefined && b.width !== undefined) point.width = mid(a.width, b.width);
    this.apply((c) => c.points.splice(best + 1, 0, point));
    this.selected = best + 1;
  }

  /** Remove the selected point (a circuit keeps at least four). */
  deleteSelected(): void {
    const i = this.selected;
    if (i === null || this.circuit.points.length <= 4) return;
    this.apply((c) => c.points.splice(i, 1));
    this.selected = null;
  }

  /** Make the selected point the start line (the loop's order is kept). */
  startHere(): void {
    const i = this.selected;
    if (i === null || i === 0) return;
    this.apply((c) => {
      c.points = [...c.points.slice(i), ...c.points.slice(0, i)];
    });
    this.selected = 0;
  }

  /** Drive the circuit the other way round (the start stays where it is). */
  reverse(): void {
    this.apply((c) => {
      c.points = [c.points[0], ...c.points.slice(1).reverse()].map((p) => (p.bank ? { ...p, bank: -p.bank } : p));
    });
    this.selected = null;
  }

  private fixSelection(): void {
    if (this.selected !== null && this.selected >= this.circuit.points.length) this.selected = null;
  }
}
