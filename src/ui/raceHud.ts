// The race panel: position, lap and the gaps to the cars either side; the start lights; and
// the results once you take the flag. Reads the race; never writes to it.

import { AI_NAMES, type Race, type Standing } from '../race/race';
import { formatLapTime } from '../race/timing';

/** The name shown for car k (0 is the player). */
export const carName = (k: number): string => (k === 0 ? 'You' : AI_NAMES[k - 1]);

/** How long the lights panel says GO after they go out (s). */
const GO_FOR = 1.2;

export class RaceHud {
  private readonly panel: HTMLDivElement;
  private readonly position: HTMLDivElement;
  private readonly lap: HTMLDivElement;
  private readonly ahead: HTMLDivElement;
  private readonly behind: HTMLDivElement;
  private readonly lights: HTMLDivElement;
  private readonly bulbs: HTMLSpanElement[];
  private readonly results: HTMLDivElement;
  private shownResults = '';

  constructor(root: HTMLElement) {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) => {
      const e = document.createElement(tag);
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    this.panel = el('div', 'race-panel', root);
    this.position = el('div', 'r-position', this.panel);
    this.lap = el('div', 'r-lap', this.panel);
    this.ahead = el('div', 'r-gap', this.panel);
    this.behind = el('div', 'r-gap', this.panel);
    this.lights = el('div', 'start-lights', root);
    this.bulbs = Array.from({ length: 5 }, () => el('span', 'bulb', this.lights));
    this.results = el('div', 'results', root);
  }

  update(race: Race): void {
    const rows = race.standings();
    const me = rows.find((r) => r.car === 0)!;
    const n = rows.length;
    this.position.innerHTML = `P${me.position}<small> / ${n}</small>`;
    const lap = Math.min(race.options.laps, Math.max(1, me.laps + 1));
    this.lap.textContent = me.finished ? 'FINISHED' : `LAP ${lap} / ${race.options.laps}`;
    const above = rows[me.position - 2];
    const below = rows[me.position];
    this.ahead.textContent = above ? `▲ ${carName(above.car)}  ${gapText(me, above)}` : '';
    this.behind.textContent = below ? `▼ ${carName(below.car)}  ${gapText(below, me)}` : '';

    // The lights: lit one by one, then GO for a moment.
    const lit = race.lights;
    const time = race.time;
    const go = race.phase === 'racing' && time !== null && time < GO_FOR;
    this.lights.style.display = race.phase === 'lights' || go ? 'flex' : 'none';
    this.lights.classList.toggle('go', go);
    this.bulbs.forEach((b, i) => b.classList.toggle('on', i < lit));

    // Results, once you have the flag (filled in as the others finish).
    const show = me.finished;
    this.results.style.display = show ? 'block' : 'none';
    if (show) {
      const html = resultsTable(rows, race.phase === 'finished');
      if (html !== this.shownResults) {
        this.results.innerHTML = html;
        this.shownResults = html;
      }
    }
  }
}

/** How far `back` is behind `front`: seconds, or laps. */
function gapText(back: Standing, front: Standing): string {
  const laps = back.lapsDown - front.lapsDown;
  if (laps > 0) return `+${laps} LAP${laps > 1 ? 'S' : ''}`;
  return `+${Math.max(0, back.gap - front.gap).toFixed(1)}`;
}

function resultsTable(rows: Standing[], final: boolean): string {
  const leader = rows[0];
  const line = (r: Standing) => {
    const time = !r.finished ? 'running' : r === leader ? formatLapTime(r.time) : r.lapsDown > 0 ? `+${r.lapsDown} lap${r.lapsDown > 1 ? 's' : ''}` : `+${r.gap.toFixed(3)}`;
    return `<tr class="${r.car === 0 ? 'me' : ''}"><td>${r.position}</td><td>${carName(r.car)}</td><td>${time}</td><td>${formatLapTime(r.bestLap)}</td></tr>`;
  };
  return `<h2>${final ? 'RESULTS' : 'PROVISIONAL RESULTS'}</h2>
    <table><thead><tr><th></th><th>Driver</th><th>Time</th><th>Best lap</th></tr></thead><tbody>${rows.map(line).join('')}</tbody></table>
    <p>⌫ race again &nbsp; Tab time trial &nbsp; N next circuit</p>`;
}
