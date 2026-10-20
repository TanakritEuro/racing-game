// The race replay's screen: the standings tower as it stood at that moment (click a car to
// follow it), what the director is showing, and a timeline along the bottom with the race's
// moments marked on it (click to jump). Plain DOM; reads the recording, never the race.

import type { RaceMoment, RaceRecording, ReplayStanding } from '../race/raceRecording';
import type { Shot } from '../replay/director';

export interface ReplayHudEvents {
  /** Follow this car (the director steps aside). */
  pick(car: number): void;
  seek(time: number): void;
}

const LABELS: Record<RaceMoment['kind'], string> = {
  start: 'Start',
  pass: 'Pass',
  stop: 'Pit stop',
  spin: 'Spin',
  recovered: 'Put back',
  contact: 'Contact',
  fastestLap: 'Fastest lap',
  lastLap: 'Last lap',
  finish: 'Finish',
};

export class ReplayHud {
  private readonly root: HTMLElement;
  private readonly tower: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private readonly caption: HTMLElement;
  private readonly timeline: HTMLElement;
  private readonly marks: HTMLElement;
  private readonly head: HTMLElement;
  private rec: RaceRecording | null = null;

  constructor(
    parent: HTMLElement,
    private readonly events: ReplayHudEvents,
    /** Each car's driver, and colour. */
    private readonly name: (car: number) => string,
    private readonly colour: (car: number) => string,
  ) {
    this.root = el('div', 'race-replay', parent);
    this.tower = el('div', 'rr-tower', this.root);
    this.caption = el('div', 'rr-caption', this.root);
    this.timeline = el('div', 'rr-timeline', this.root);
    this.marks = el('div', 'rr-marks', this.timeline);
    this.head = el('div', 'rr-head', this.timeline);
    this.timeline.addEventListener('click', (e) => {
      if (!this.rec) return;
      const box = this.timeline.getBoundingClientRect();
      this.events.seek(((e.clientX - box.left) / box.width) * this.rec.duration);
    });
  }

  /** A new recording: the tower's rows and the moments on the timeline. */
  load(rec: RaceRecording, moments: readonly RaceMoment[]): void {
    this.rec = rec;
    this.tower.replaceChildren();
    this.rows.length = 0;
    rec.cars.forEach(() => {
      const row = el('div', 'rr-row', this.tower);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.events.pick(Number(row.dataset.car));
      });
      this.rows.push(row);
    });
    this.marks.replaceChildren();
    for (const m of moments) {
      const mark = el('div', `rr-mark rr-${m.kind}`, this.marks);
      mark.style.left = `${(100 * m.time) / Math.max(1e-6, rec.duration)}%`;
      mark.title = `${LABELS[m.kind]}: ${m.cars.map((c) => this.name(c)).join(' on ')}`;
    }
  }

  update(t: number, standings: readonly ReplayStanding[], followed: number, shot: Shot | null, laps: number): void {
    const rec = this.rec;
    if (!rec) return;
    standings.forEach((r, i) => {
      const row = this.rows[i];
      row.dataset.car = String(r.car);
      row.classList.toggle('followed', r.car === followed);
      row.classList.toggle('me', r.car === 0);
      const gap = i === 0 ? (r.finished ? 'FINISHED' : `LAP ${Math.min(laps, r.laps + 1)}`) : r.gap > 0 ? `+${r.gap.toFixed(1)}` : '';
      const html = `<span class="rr-pos">${r.position}</span><span class="rr-chip" style="background:${this.colour(r.car)}"></span><span class="rr-name">${this.name(r.car)}</span><span class="rr-gap">${gap}</span>`;
      if (row.dataset.html !== html) {
        row.innerHTML = html;
        row.dataset.html = html;
      }
    });
    const what = shot?.moment ? `${LABELS[shot.moment.kind]}${shot.moment.kind === 'pass' ? ` on ${this.name(shot.moment.cars[1])}` : ''}` : shot?.reason === 'battle' ? 'Battle' : '';
    this.caption.textContent = `${this.name(followed)}${what ? `  ·  ${what}` : ''}${shot ? '' : '  ·  your choice (D: the director)'}`;
    this.head.style.left = `${(100 * t) / Math.max(1e-6, rec.duration)}%`;
  }
}

function el(tag: string, cls: string, parent: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}
