// The track editor's screen: the map and the panel around the editor's state. Each change
// rebuilds the circuit and checks it (while a point or slider is moving, only the road is
// rebuilt, for speed; the full circuit, with kerbs, pit lane and checks, when it stops). The
// work in progress is kept as a draft, so a reload doesn't lose it.

import { CIRCUITS } from '../track/circuits';
import { customDef, customId, fromBuiltIn, LIMITS, ovalTemplate, cleanCustom, type CustomCircuit } from '../track/custom';
import { buildTrack, type Track } from '../track/track';
import { validateTrack, type Problem } from '../track/validate';
import { packCircuit } from '../share';
import { CustomTrackStore } from '../storage/customTracks';
import { div } from '../ui/menu';
import { MapView } from './mapView';
import { Panels } from './panels';
import { EditorState } from './state';

const DRAFT = 'racing.editor.draft.v1';

export interface EditorOptions {
  /** The saved circuit to edit (its id), or null for the draft (or a blank oval). */
  id: string | null;
  /** A circuit to start from instead (opened from a shared link). */
  circuit?: CustomCircuit | null;
  /** Drive it: go to the game on circuit `id`. */
  drive(id: string): void;
  quit(): void;
}

export function openEditor(parent: HTMLElement, options: EditorOptions): void {
  const store = new CustomTrackStore();
  const saved = options.id ? store.get(options.id) : null;
  const start = options.circuit ?? saved ?? loadDraft() ?? ovalTemplate();
  const state = new EditorState(start);
  /** The id the circuit was saved under (an edit replaces it). */
  let savedAs: string | null = saved ? options.id : null;
  let track: Track | null = null;
  let problems: Problem[] | null = null;
  let note = '';

  const root = div(parent, 'editor-root');
  const map = new MapView(div(root, 'editor-map-box'), {
    select(i) {
      state.selected = i;
      render();
    },
    dragStart() {
      state.begin();
    },
    drag(i, x, z) {
      state.live((c) => {
        c.points[i] = { ...c.points[i], x: clamp(x), z: clamp(z) };
      });
      quick();
    },
    dragEnd() {
      state.end();
      full();
    },
    click(x, z) {
      if (state.circuit.points.length >= LIMITS.points[1]) return;
      state.insertPoint(clamp(x), clamp(z));
      full();
    },
  });
  const panels = new Panels(
    root,
    {
      change(edit, live) {
        if (live) {
          if (!moving) {
            state.begin();
            moving = true;
          }
          state.live(edit);
          quick();
        } else {
          if (moving) {
            state.live(edit);
            state.end();
            moving = false;
          } else state.apply(edit);
          full();
        }
      },
      undo: () => (state.undo(), full()),
      redo: () => (state.redo(), full()),
      fit: () => map.fit(),
      reverse: () => (state.reverse(), full()),
      startHere: () => (state.startHere(), full()),
      deletePoint: () => (state.deleteSelected(), full()),
      focus(at) {
        if (!track) return;
        const n = track.samples.length;
        const p = track.samples[Math.round((at / track.length) * n) % n];
        map.centreOn(p.x, p.z);
      },
      testDrive() {
        if (!saveCircuit()) return;
        options.drive(customId(state.circuit));
      },
      save() {
        if (saveCircuit()) setNote('Saved. It is in the start menu with the other circuits.');
      },
      copyLink() {
        const url = `${location.origin}${location.pathname}?share=${packCircuit(state.circuit)}`;
        void navigator.clipboard?.writeText(url).then(
          () => setNote('Link copied: anyone who opens it can drive this circuit.'),
          () => setNote(url),
        );
      },
      startFrom(id) {
        const def = CIRCUITS.find((c) => c.id === id);
        state.apply((c) => Object.assign(c, def ? fromBuiltIn(def) : ovalTemplate()));
        savedAs = null;
        state.selected = null;
        full();
        map.fit();
      },
      quit: () => options.quit(),
    },
    CIRCUITS.map((c) => ({ id: c.id, name: c.name })),
  );
  let moving = false;

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) state.redo();
      else state.undo();
      full();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      state.redo();
      full();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      state.deleteSelected();
      full();
    } else if (e.code === 'Escape') {
      state.selected = null;
      render();
    }
  });

  function saveCircuit(): boolean {
    if (problems === null || problems.length > 0) {
      setNote('Fix the problems first.');
      return false;
    }
    if (!store.save(state.circuit, savedAs)) {
      setNote('Twenty circuits are kept: delete one from the start menu first.');
      return false;
    }
    savedAs = customId(state.circuit);
    return true;
  }

  function setNote(text: string): void {
    note = text;
    render();
  }

  /** While moving: the road alone, fast; no checks yet. */
  function quick(): void {
    const c = state.circuit;
    try {
      track = buildTrack({ id: 'editing', name: c.name, points: c.points, width: c.width, runoff: c.runoff });
    } catch {
      track = null;
    }
    problems = null;
    render();
  }

  /** At rest: the whole circuit, and its checks; kept as the draft. */
  function full(): void {
    note = '';
    try {
      track = buildTrack(customDef(state.circuit));
      problems = validateTrack(track);
    } catch {
      track = null;
      problems = [{ rule: 'length', message: 'This layout cannot be built: move the points apart.', at: [] }];
    }
    saveDraft(state.circuit);
    render();
  }

  function render(): void {
    map.set(state.circuit.points, track, problems ?? [], state.selected);
    panels.update({ circuit: state.circuit, selected: state.selected, problems, length: track?.length ?? null, canUndo: state.canUndo, canRedo: state.canRedo, note });
  }

  full();
  map.fit();
}

const clamp = (v: number) => Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, v));

function loadDraft(): CustomCircuit | null {
  try {
    return cleanCustom(JSON.parse(localStorage.getItem(DRAFT) ?? 'null'));
  } catch {
    return null;
  }
}

function saveDraft(c: CustomCircuit): void {
  try {
    localStorage.setItem(DRAFT, JSON.stringify(c));
  } catch {
    // No draft this time.
  }
}
