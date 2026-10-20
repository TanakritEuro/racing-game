// The career screen: the ladder of series (locked, open, being run, your best finish), the
// season in progress and its next round, your money, and the upgrade shop for each car you
// own. Plain DOM in the menus' style; choices go out through `CareerEvents`.

import { careerProgress, SERIES, type Career } from '../race/career';
import { roundConditions, seasonOver, standings } from '../race/championship';
import { UPGRADE_KINDS, UPGRADE_NAMES, upgradePrice, type UpgradeKind } from '../vehicle/upgrades';
import { TUNING } from '../config';
import { button, div } from './menu';

export interface CareerEvents {
  /** Race the season's next round. */
  race(): void;
  /** Start a new season of series `index`. */
  startSeries(index: number): void;
  buy(car: string, kind: UpgradeKind): void;
  newCareer(): void;
  close(): void;
}

const money = (m: number) => `${Math.round(m).toLocaleString('en-GB')} cr`;
const ordinal = (n: number) => `P${n}`;

export class CareerScreen {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly events: CareerEvents,
    /** Each entry's name (0 is you), and each circuit's name. */
    private readonly name: (entry: number) => string,
    private readonly circuitName: (id: string) => string,
  ) {
    this.root = div(parent, 'menu-root hidden');
    this.panel = div(this.root, 'menu career');
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** Show `career` (null: none yet, offer to start one). */
  show(career: Career | null): void {
    this.root.classList.remove('hidden');
    const p = this.panel;
    p.replaceChildren();
    div(p, 'menu-title', 'CAREER');
    if (!career) {
      div(p, 'menu-help', 'Three series, each a step up: the Club Cup in the Wren, the National Series in the Kestrel, the Grand Championship in the Harrier. Finish a season in the top three to move up. Every race pays; the money buys upgrades for your cars.');
      const row = div(p, 'menu-row');
      button(row, 'Start a career', 'menu-go').addEventListener('click', () => this.events.newCareer());
      button(row, 'Back').addEventListener('click', () => this.events.close());
      return;
    }
    div(p, 'career-money', career.complete ? `${money(career.money)} · Career complete: Grand Champion!` : money(career.money));

    // The ladder.
    const ladder = div(p, 'career-ladder');
    SERIES.forEach((s, i) => {
      const card = div(ladder, 'career-series');
      const locked = i > career.reached;
      card.classList.toggle('locked', locked);
      card.classList.toggle('current', i === career.series);
      div(card, 'career-series-name', s.name);
      div(card, 'menu-card-sub', `${s.car} · ${s.difficulty} rivals`);
      div(card, 'menu-card-sub', `${s.weather ? 'any weather' : 'dry'} · ${s.wear === 'off' ? 'no tyre wear' : `${s.wear} tyre wear`}`);
      const best = career.best[i];
      div(card, 'career-status', locked ? `Opens for a top ${TUNING.career.promotion} in the ${SERIES[i - 1].name}` : i === career.series && !seasonOver(career.season) ? 'Season in progress' : best ? `Best: ${ordinal(best)}` : 'Open');
      if (!locked && (i !== career.series || seasonOver(career.season))) {
        button(card, best ? 'Run a season' : 'Start').addEventListener('click', () => this.events.startSeries(i));
      }
    });

    // The season in progress.
    const s = SERIES[career.series];
    const season = career.season;
    const { round, rounds } = careerProgress(career);
    const box = div(p, 'career-season');
    div(box, 'career-season-title', `${s.name} · ${seasonOver(season) ? 'season over' : `round ${round + 1} of ${rounds}`}`);
    const rows = standings(season);
    const mine = rows.findIndex((r) => r.entry === 0);
    if (round > 0) {
      const table = div(box, 'career-standings');
      rows.forEach((r, i) => {
        if (i >= 3 && r.entry !== 0) return;
        div(table, r.entry === 0 ? 'career-row me' : 'career-row', `${ordinal(i + 1)}  ${this.name(r.entry)}  ${r.points} pts`);
      });
    }
    if (!seasonOver(season)) {
      const next = season.rounds[round];
      const weather = roundConditions(season, round);
      div(box, 'menu-help', `Next: ${this.circuitName(next.track)}, ${next.laps} laps${weather === 'dry' ? '' : `, ${weather}`}`);
      const row = div(box, 'menu-row');
      button(row, `Race round ${round + 1}`, 'menu-go').addEventListener('click', () => this.events.race());
    } else {
      div(box, 'menu-help', `You finished ${ordinal(mine + 1)}. Choose a series above for your next season.`);
    }

    // The garage: upgrades for each car you own.
    const garage = div(p, 'career-garage');
    div(garage, 'career-season-title', 'Garage');
    for (const [car, upgrades] of Object.entries(career.garage)) {
      const block = div(garage, 'career-car');
      div(block, 'career-series-name', car);
      for (const kind of UPGRADE_KINDS) {
        const level = upgrades[kind];
        const price = upgradePrice(kind, level);
        const row = div(block, 'career-upgrade');
        div(row, 'career-upgrade-name', `${UPGRADE_NAMES[kind].name}`);
        div(row, 'career-upgrade-level', '●'.repeat(level) + '○'.repeat(TUNING.upgrades.levels - level));
        const buy = button(row, price === null ? 'Top level' : `Buy ${money(price)}`);
        buy.title = UPGRADE_NAMES[kind].does;
        buy.disabled = price === null || price > career.money;
        buy.addEventListener('click', () => this.events.buy(car, kind));
      }
    }

    const row = div(p, 'menu-row');
    button(row, 'Back to menu').addEventListener('click', () => this.events.close());
    button(row, 'New career').addEventListener('click', () => this.events.newCareer());
  }
}
