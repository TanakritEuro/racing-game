// The editor's side panel: the circuit's settings, the selected point's, the problems (or
// "ready to drive"), and the buttons. Plain DOM; every change goes back through `PanelEvents`.

import { LIMITS, type CustomCircuit } from '../track/custom';
import type { Problem } from '../track/validate';
import { button, div } from '../ui/menu';

export interface PanelEvents {
  /** Change the circuit: `live` while a slider moves (no undo step yet), then once more with `live` false. */
  change(edit: (c: CustomCircuit) => void, live: boolean): void;
  undo(): void;
  redo(): void;
  fit(): void;
  reverse(): void;
  startHere(): void;
  deletePoint(): void;
  /** Look at a problem's place on the map. */
  focus(at: number): void;
  testDrive(): void;
  save(): void;
  copyLink(): void;
  /** Start again: from the blank oval, or a copy of the built-in circuit with this id. */
  startFrom(id: string): void;
  quit(): void;
}

export interface PanelView {
  circuit: CustomCircuit;
  selected: number | null;
  problems: readonly Problem[] | null;
  /** The built circuit's length (m), or null. */
  length: number | null;
  canUndo: boolean;
  canRedo: boolean;
  /** A note after Save / Copy link. */
  note: string;
}

const deg = Math.PI / 180;

export class Panels {
  private readonly root: HTMLElement;
  private readonly refresh: ((v: PanelView) => void)[] = [];

  constructor(
    parent: HTMLElement,
    private readonly events: PanelEvents,
    starts: readonly { id: string; name: string }[],
  ) {
    this.root = div(parent, 'editor-panel');
    div(this.root, 'editor-title', 'Track editor');

    const name = document.createElement('input');
    name.className = 'editor-name';
    name.maxLength = LIMITS.name;
    name.placeholder = 'Circuit name';
    this.root.appendChild(name);
    name.addEventListener('change', () => events.change((c) => (c.name = name.value.trim() || 'Custom circuit'), false));
    this.refresh.push((v) => {
      if (document.activeElement !== name) name.value = v.circuit.name;
    });

    const tools = div(this.root, 'editor-row');
    const undo = button(tools, 'Undo');
    undo.addEventListener('click', () => events.undo());
    const redo = button(tools, 'Redo');
    redo.addEventListener('click', () => events.redo());
    button(tools, 'Fit').addEventListener('click', () => events.fit());
    button(tools, 'Reverse').addEventListener('click', () => events.reverse());
    this.refresh.push((v) => {
      undo.disabled = !v.canUndo;
      redo.disabled = !v.canRedo;
    });
    div(this.root, 'editor-help', 'Drag a point to move it. Click the ground to add a point there. Drag the ground to pan, wheel to zoom. Delete removes the selected point; Ctrl+Z undoes.');

    // The selected point.
    const point = div(this.root, 'editor-section');
    const pointTitle = div(point, 'editor-section-title');
    this.slider(point, 'Elevation', LIMITS.elevation[0], LIMITS.elevation[1], 0.5, 'm', (v) => (v.selected === null ? 0 : (v.circuit.points[v.selected].y ?? 0)), (c, x, v) => {
      if (v.selected !== null) c.points[v.selected].y = x;
    });
    this.slider(point, 'Banking', -12, 12, 0.5, '°', (v) => (v.selected === null ? 0 : (v.circuit.points[v.selected].bank ?? 0) / deg), (c, x, v) => {
      if (v.selected !== null) c.points[v.selected].bank = x * deg;
    });
    this.slider(point, 'Width', LIMITS.width[0], LIMITS.width[1], 0.5, 'm', (v) => (v.selected === null ? 12 : (v.circuit.points[v.selected].width ?? v.circuit.width)), (c, x, v) => {
      if (v.selected !== null) c.points[v.selected].width = x;
    });
    const pointButtons = div(point, 'editor-row');
    const start = button(pointButtons, 'Start here');
    start.addEventListener('click', () => events.startHere());
    const del = button(pointButtons, 'Delete point');
    del.addEventListener('click', () => events.deletePoint());
    this.refresh.push((v) => {
      point.classList.toggle('hidden', v.selected === null);
      if (v.selected === null) return;
      pointTitle.textContent = v.selected === 0 ? 'Point S (the start line)' : `Point ${v.selected}`;
      start.disabled = v.selected === 0;
      del.disabled = v.circuit.points.length <= LIMITS.points[0];
    });

    // The circuit.
    const circuit = div(this.root, 'editor-section');
    div(circuit, 'editor-section-title', 'Circuit');
    this.slider(circuit, 'Road width', LIMITS.width[0], LIMITS.width[1], 0.5, 'm', (v) => v.circuit.width, (c, x) => (c.width = x));
    this.slider(circuit, 'Run-off', LIMITS.runoff[0], LIMITS.runoff[1], 1, 'm', (v) => v.circuit.runoff.width, (c, x) => (c.runoff.width = x));
    this.slider(circuit, 'Hills', LIMITS.hills[0], LIMITS.hills[1], 1, 'm', (v) => v.circuit.hills, (c, x) => (c.hills = x));
    this.slider(circuit, 'Trees', LIMITS.trees[0], LIMITS.trees[1], 50, '', (v) => v.circuit.trees, (c, x) => (c.trees = x));
    this.choice(circuit, 'Run-off is', [['grass', 'Grass'], ['gravel', 'Gravel']], (v) => v.circuit.runoff.surface, (c, x) => (c.runoff.surface = x as 'grass' | 'gravel'));
    this.choice(circuit, 'Pits on the', [['left', 'Left'], ['right', 'Right']], (v) => v.circuit.pitSide, (c, x) => (c.pitSide = x as 'left' | 'right'));
    this.choice(circuit, 'Kerbs at corners', [['yes', 'Yes'], ['no', 'No']], (v) => (v.circuit.kerbs ? 'yes' : 'no'), (c, x) => (c.kerbs = x === 'yes'));
    this.choice(circuit, 'Gravel at hairpins', [['yes', 'Yes'], ['no', 'No']], (v) => (v.circuit.gravel ? 'yes' : 'no'), (c, x) => (c.gravel = x === 'yes'));

    // The problems.
    const problems = div(this.root, 'editor-problems');
    this.refresh.push((v) => {
      problems.replaceChildren();
      if (v.problems === null) {
        div(problems, 'editor-ok', 'Checking…');
        return;
      }
      if (v.problems.length === 0) {
        div(problems, 'editor-ok', `Ready to drive · ${((v.length ?? 0) / 1000).toFixed(2)} km`);
        return;
      }
      for (const p of v.problems) {
        const item = div(problems, 'editor-problem', p.message);
        if (p.at.length > 0) {
          item.classList.add('clickable');
          item.title = 'Show it on the map';
          item.addEventListener('click', () => events.focus(p.at[0]));
        }
      }
    });

    const go = div(this.root, 'editor-row editor-go');
    const drive = button(go, 'Test drive', 'menu-go');
    drive.addEventListener('click', () => events.testDrive());
    button(go, 'Save').addEventListener('click', () => events.save());
    button(go, 'Copy link').addEventListener('click', () => events.copyLink());
    const note = div(this.root, 'editor-note');
    this.refresh.push((v) => {
      drive.disabled = v.problems === null || v.problems.length > 0;
      note.textContent = v.note;
    });

    const more = div(this.root, 'editor-row');
    const from = document.createElement('select');
    from.className = 'editor-select';
    for (const [value, label] of [['', 'Start again from…'], ['oval', 'A blank oval'], ...starts.map((s) => [s.id, `A copy of ${s.name}`])]) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      from.appendChild(o);
    }
    from.addEventListener('change', () => {
      if (from.value) events.startFrom(from.value);
      from.value = '';
    });
    more.appendChild(from);
    button(more, 'Back to menu').addEventListener('click', () => events.quit());

    // Keys typed here are for the panel, not the map's shortcuts.
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  update(view: PanelView): void {
    for (const f of this.refresh) f(view);
  }

  private last: PanelView | null = null;

  /** A labelled slider with its value. */
  private slider(parent: HTMLElement, label: string, min: number, max: number, step: number, unit: string, get: (v: PanelView) => number, set: (c: CustomCircuit, x: number, v: PanelView) => void): void {
    const row = div(parent, 'editor-slider');
    div(row, 'editor-label', label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    row.appendChild(input);
    const value = div(row, 'editor-value');
    const show = (x: number) => (value.textContent = `${Number.isInteger(step) ? Math.round(x) : x.toFixed(1)}${unit ? ` ${unit}` : ''}`);
    input.addEventListener('input', () => {
      const v = this.last;
      if (!v) return;
      show(Number(input.value));
      this.events.change((c) => set(c, Number(input.value), v), true);
    });
    input.addEventListener('change', () => {
      const v = this.last;
      if (v) this.events.change((c) => set(c, Number(input.value), v), false);
    });
    this.refresh.push((v) => {
      this.last = v;
      if (document.activeElement === input) return;
      input.value = String(get(v));
      show(get(v));
    });
  }

  /** A labelled row of choices. */
  private choice(parent: HTMLElement, label: string, options: readonly (readonly [string, string])[], get: (v: PanelView) => string, set: (c: CustomCircuit, x: string) => void): void {
    const row = div(parent, 'editor-slider');
    div(row, 'editor-label', label);
    const box = div(row, 'editor-choices');
    for (const [value, text] of options) {
      const b = button(box, text);
      b.addEventListener('click', () => this.events.change((c) => set(c, value), false));
      this.refresh.push((v) => b.classList.toggle('selected', get(v) === value));
    }
  }
}
