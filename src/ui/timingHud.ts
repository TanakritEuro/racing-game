// The timing panel: circuit, lap and its time, the live delta to the best lap, sector splits
// and the last and best laps. Reads the lap timer; never writes to it.

import { formatDelta, formatLapTime, type LapTimer } from '../race/timing';

/** How long a finished lap's splits stay up before the next lap's take over (s). */
const HOLD = 4;

type Colour = 'best' | 'faster' | 'slower' | '';

export class TimingHud {
  private readonly lap: HTMLDivElement;
  private readonly delta: HTMLDivElement;
  private readonly splits: HTMLDivElement[];
  private readonly last: HTMLDivElement;
  private readonly best: HTMLDivElement;
  private readonly noteLine: HTMLDivElement;
  /** The bests as they stood when this lap began: splits are judged against them. */
  private refSectors: (number | null)[] = [null, null, null];
  private refLapSectors: number[] | null = null;
  private laps = -1;
  private lapStarted = false;
  /** Shown splits: time and colour, kept for HOLD seconds after the lap ends. */
  private shown: ({ time: number; colour: Colour } | null)[] = [null, null, null];
  private holdUntil = -Infinity;

  constructor(root: HTMLElement) {
    const el = (cls: string, parent: HTMLElement = root) => {
      const d = document.createElement('div');
      d.className = cls;
      parent.appendChild(d);
      return d;
    };
    this.lap = el('t-lap');
    this.delta = el('t-delta');
    const row = el('t-splits');
    this.splits = [0, 1, 2].map(() => el('t-split', row));
    this.last = el('t-last');
    this.best = el('t-best');
    this.noteLine = el('t-note');
  }

  /** A line under the times (e.g. that bests aren't being kept); empty hides it. */
  set note(text: string) {
    this.noteLine.textContent = text;
  }

  update(timer: LapTimer, time: number): void {
    const elapsed = timer.current(time);
    const timed = elapsed !== null;
    // A lap just finished: show its last sector, hold the splits, then start over.
    if (timer.laps !== this.laps) {
      if (this.laps >= 0 && timer.lastSectors) {
        this.judge(2, timer.lastSectors[2]);
        this.holdUntil = time + HOLD;
      }
      this.laps = timer.laps;
      this.lapStarted = false;
    }
    if (timed && !this.lapStarted && time >= this.holdUntil) {
      this.lapStarted = true;
      this.refSectors = [...timer.bestSectors];
      this.refLapSectors = timer.best ? [...timer.best.sectors] : null;
      this.shown = [null, null, null];
    }
    if (this.lapStarted) timer.sectors.forEach((t, k) => t !== null && k < 2 && !this.shown[k] && this.judge(k, t));

    this.lap.textContent = timed ? `LAP ${timer.laps + 1}  ${formatLapTime(elapsed)}${timer.invalid ? '  INVALID' : ''}` : 'OUT LAP';
    this.lap.classList.toggle('invalid', timer.invalid);
    const delta = timer.delta(time);
    this.delta.textContent = delta === null ? '' : formatDelta(delta);
    this.delta.className = `t-delta ${delta === null ? '' : delta < 0 ? 'faster' : 'slower'}`;
    this.splits.forEach((d, k) => {
      const s = this.shown[k];
      d.textContent = `S${k + 1} ${s ? s.time.toFixed(3) : '––.–––'}`;
      d.className = `t-split ${s?.colour ?? ''}`;
    });
    this.last.textContent = `LAST ${formatLapTime(timer.lastLap)}${timer.lastLap !== null && !timer.lastValid ? ' (invalid)' : ''}`;
    this.best.textContent = `BEST ${formatLapTime(timer.bestLap)}`;
  }

  /** Colour a split: purple for the best ever in that sector, green for faster than the best lap's, yellow slower. */
  private judge(k: number, time: number): void {
    const ref = this.refSectors[k];
    const lapRef = this.refLapSectors?.[k] ?? null;
    let colour: Colour = '';
    if (ref !== null && time < ref) colour = 'best';
    else if (lapRef !== null) colour = time < lapRef ? 'faster' : 'slower';
    this.shown[k] = { time, colour };
  }
}
