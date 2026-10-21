// A rally stage on screen: the countdown on the line, the clock with any penalties, and at the
// flying finish your time among the rivals'. Plain DOM; reads the stage run, never writes to it.

import type { RivalTime } from '../ai/stageTimes';
import type { StageRun } from '../race/stage';
import { formatLapTime } from '../race/timing';

export class StageHud {
  private readonly countdown: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly results: HTMLElement;
  private shown = '';

  constructor(
    root: HTMLElement,
    /** Each rival's name. */
    private readonly name: (driver: number) => string,
    private readonly footer: string,
  ) {
    const el = (cls: string) => {
      const e = document.createElement('div');
      e.className = cls;
      root.appendChild(e);
      return e;
    };
    this.countdown = el('stage-countdown');
    this.clock = el('stage-clock');
    this.results = el('results stage-results');
  }

  update(run: StageRun, rivals: readonly RivalTime[]): void {
    const count = run.countdown;
    const go = run.phase === 'running' && (run.clock ?? 0) < 1;
    this.countdown.style.display = run.phase === 'countdown' || go ? 'block' : 'none';
    this.countdown.textContent = run.phase === 'countdown' ? String(Math.max(1, Math.ceil(count))) : 'GO';
    this.countdown.classList.toggle('go', go);
    const t = run.clock;
    const penalties = run.penalties > 0 ? `  ·  +${run.penalties} s` : '';
    this.clock.textContent = t === null ? 'STAGE' : `${formatLapTime(t)}${penalties}`;
    this.results.style.display = run.phase === 'finished' ? 'block' : 'none';
    if (run.phase !== 'finished' || run.result === null) return;
    const mine = run.result;
    const html = resultsTable(mine, rivals, this.name, this.footer, run.penalties);
    if (html !== this.shown) {
      this.results.innerHTML = html;
      this.shown = html;
    }
  }
}

function resultsTable(mine: number, rivals: readonly RivalTime[], name: (driver: number) => string, footer: string, penalties: number): string {
  const rows = [...rivals.map((r) => ({ who: name(r.driver), time: r.time, me: false })), { who: 'You', time: mine, me: true }].sort((a, b) => a.time - b.time);
  const place = rows.findIndex((r) => r.me) + 1;
  const best = rows[0].time;
  const body = rows
    .map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${r.who}</td><td>${i === 0 ? formatLapTime(r.time) : `+${(r.time - best).toFixed(1)}`}</td></tr>`)
    .join('');
  const note = penalties > 0 ? ` (with ${penalties} s of penalties)` : '';
  return `<h2>STAGE FINISHED · P${place}</h2><table><tr><th></th><th>Driver</th><th>Time</th></tr>${body}</table><p>${formatLapTime(mine)}${note}. ${footer}</p>`;
}
