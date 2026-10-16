// The championship standings: after each round (with Next round) and at the end of the
// season (the champion, and back to the menu). Reads a season; never changes it.

import { standings, type Season } from '../race/championship';
import { button, div } from './menu';

export interface StandingsEvents {
  /** Go on to the next round. */
  onNext(): void;
  /** Back to the start menu. */
  onMenu(): void;
}

export class StandingsScreen {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly events: StandingsEvents,
    /** Each entry's name (0 is you) and colour, and each circuit's name. */
    private readonly name: (entry: number) => string,
    private readonly colour: (entry: number) => string,
    private readonly circuitName: (id: string) => string,
  ) {
    this.root = div(parent, 'menu-root hidden');
    this.panel = div(this.root, 'menu standings');
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(season: Season): void {
    const rows = standings(season);
    const done = season.results.length;
    const over = done >= season.rounds.length;
    this.panel.innerHTML = '';
    const last = season.rounds[done - 1];
    div(this.panel, 'menu-title', over ? 'CHAMPIONSHIP: FINAL' : 'CHAMPIONSHIP');
    div(this.panel, 'menu-help', `After round ${done} of ${season.rounds.length}${last ? `, ${this.circuitName(last.track)}` : ''}`);
    if (over) {
      const champion = rows[0];
      div(this.panel, 'standings-champion', champion.entry === 0 ? 'You are the champion!' : `${this.name(champion.entry)} is the champion`);
    }

    const table = document.createElement('table');
    table.className = 'standings-table';
    const head = table.createTHead().insertRow();
    for (const h of ['', 'Driver', ...season.rounds.map((_, i) => `R${i + 1}`), 'Points', '']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    const leader = rows[0].points;
    rows.forEach((row, i) => {
      const tr = body.insertRow();
      if (row.entry === 0) tr.className = 'me';
      tr.insertCell().textContent = String(i + 1);
      const who = tr.insertCell();
      const swatch = document.createElement('span');
      swatch.className = 'standings-swatch';
      swatch.style.background = this.colour(row.entry);
      who.append(swatch, this.name(row.entry));
      season.rounds.forEach((_, r) => {
        const f = row.finishes[r];
        tr.insertCell().textContent = f === undefined ? '' : `P${f}`;
      });
      const points = tr.insertCell();
      points.className = 'standings-points';
      points.textContent = String(row.points);
      const gain = tr.insertCell();
      gain.className = 'standings-gain';
      gain.textContent = row.lastRound > 0 ? `+${row.lastRound}` : i > 0 ? `−${leader - row.points}` : '';
      if (row.lastRound === 0 && i > 0) gain.classList.add('behind');
    });
    this.panel.appendChild(table);

    const actions = div(this.panel, 'menu-row');
    if (!over) {
      const next = season.rounds[done];
      button(actions, `Next round: ${this.circuitName(next.track)}`, 'menu-go').addEventListener('click', () => this.events.onNext());
      button(actions, 'Back to menu').addEventListener('click', () => this.events.onMenu());
    } else {
      button(actions, 'Back to menu', 'menu-go').addEventListener('click', () => this.events.onMenu());
    }
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
