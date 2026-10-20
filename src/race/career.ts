// A career: a ladder of three series, each a championship season in its own car against its
// own field. Finish a series in the top three and the next one opens (and its car is yours);
// otherwise run it again. Every round pays prize money, by position and series; the money
// buys upgrades for the cars you own. Win the top series and the career is complete. Pure
// data and functions; saved as plain JSON.

import type { Difficulty } from '../ai/skill';
import { TUNING } from '../config';
import { cleanUpgrades, noUpgrades, upgradePrice, type UpgradeKind, type Upgrades } from '../vehicle/upgrades';
import type { WearRate } from '../vehicle/wear';
import { newSeason, nextRound, parseSeason, recordRound, roundRace, seasonOver, standings, type Season } from './championship';
import type { RaceOptions } from './race';

export interface SeriesDef {
  id: 'club' | 'national' | 'grand';
  name: string;
  car: string;
  difficulty: Difficulty;
  rounds: readonly { track: string; laps: number }[];
  /** Weather drawn per round (or always dry), and how fast tyres wear. */
  weather: boolean;
  wear: WearRate;
  /** Dusk and night drawn per round (or always by day); the season's last round under lights. */
  times: boolean;
  nightFinal: boolean;
  /** Prize money per round by position (1st first), and the bonus for the season's top three. */
  prize: readonly number[];
  bonus: readonly number[];
}

const scale = (values: readonly number[], k: number) => values.map((v) => Math.round((v * k) / 10) * 10);
const ROUND_PRIZE = [600, 450, 350, 280, 220, 170, 130, 100];
const SEASON_BONUS = [2500, 1500, 1000];

export const SERIES: readonly SeriesDef[] = [
  {
    id: 'club',
    name: 'Club Cup',
    car: 'Wren',
    difficulty: 'easy',
    rounds: [
      { track: 'proving-ground', laps: 4 },
      { track: 'saltmarsh', laps: 2 },
      { track: 'ridgeback', laps: 2 },
      { track: 'harrowmere', laps: 2 },
    ],
    weather: false,
    wear: 'off',
    times: false,
    nightFinal: false,
    prize: ROUND_PRIZE,
    bonus: SEASON_BONUS,
  },
  {
    id: 'national',
    name: 'National Series',
    car: 'Kestrel',
    difficulty: 'medium',
    rounds: [
      { track: 'saltmarsh', laps: 3 },
      { track: 'ridgeback', laps: 3 },
      { track: 'harrowmere', laps: 3 },
      { track: 'proving-ground', laps: 6 },
    ],
    weather: true,
    wear: 'normal',
    times: true,
    nightFinal: false,
    prize: scale(ROUND_PRIZE, 2),
    bonus: scale(SEASON_BONUS, 2),
  },
  {
    id: 'grand',
    name: 'Grand Championship',
    car: 'Harrier',
    difficulty: 'hard',
    rounds: [
      { track: 'harrowmere', laps: 6 },
      { track: 'saltmarsh', laps: 8 },
      { track: 'ridgeback', laps: 6 },
      { track: 'proving-ground', laps: 12 },
    ],
    weather: true,
    wear: 'high',
    times: true,
    // The finale at the Proving Ground: twelve laps under the lights.
    nightFinal: true,
    prize: scale(ROUND_PRIZE, 3.5),
    bonus: scale(SEASON_BONUS, 3),
  },
];

export interface Career {
  version: 1;
  seed: number;
  /** The highest series open (index into SERIES), and the one being run. */
  reached: number;
  series: number;
  /** Seasons started so far (each gets its own seed). */
  seasons: number;
  season: Season;
  money: number;
  /** The cars you own, and their upgrades. */
  garage: Record<string, Upgrades>;
  /** Your best final position in each series (null until you've finished a season of it). */
  best: (number | null)[];
  complete: boolean;
}

/** What a round came to: the prize, and at a season's end your position, its bonus and what it opened. */
export interface RoundResult {
  career: Career;
  position: number;
  prize: number;
  /** At the end of a season: your final position in it, the bonus, and the series it opened (or null). */
  final: { position: number; bonus: number; promoted: SeriesDef | null; complete: boolean } | null;
}

function seasonFor(series: number, seed: number): Season {
  const s = SERIES[series];
  return newSeason(seed, s.difficulty, s.car, { rounds: s.rounds, weather: s.weather, wear: s.wear, times: s.times, nightFinal: s.nightFinal });
}

export function newCareer(seed: number): Career {
  return {
    version: 1,
    seed,
    reached: 0,
    series: 0,
    seasons: 1,
    season: seasonFor(0, seed * 100 + 1),
    money: 0,
    garage: { [SERIES[0].car]: noUpgrades() },
    best: SERIES.map(() => null),
    complete: false,
  };
}

/** The next round's race: its circuit and options, and your car with its upgrades. */
export function careerRound(career: Career): { track: string; options: RaceOptions; car: string; upgrades: Upgrades } {
  const { track, options } = roundRace(career.season);
  const car = SERIES[career.series].car;
  return { track, options, car, upgrades: career.garage[car] ?? noUpgrades() };
}

/** A finished round (its finishing order, entry numbers, winner first): the prize, and at a season's end promotion. */
export function recordCareerRound(career: Career, order: readonly number[]): RoundResult {
  if (seasonOver(career.season)) return { career, position: 0, prize: 0, final: null };
  const s = SERIES[career.series];
  const season = recordRound(career.season, order);
  const position = order.indexOf(0) + 1;
  const prize = s.prize[position - 1] ?? 0;
  let next: Career = { ...career, season, money: career.money + prize };
  if (!seasonOver(season)) return { career: next, position, prize, final: null };

  const final = standings(season).findIndex((r) => r.entry === 0) + 1;
  const bonus = s.bonus[final - 1] ?? 0;
  const best = [...next.best];
  best[career.series] = Math.min(best[career.series] ?? Infinity, final);
  next = { ...next, money: next.money + bonus, best };
  let promoted: SeriesDef | null = null;
  const last = SERIES.length - 1;
  if (final <= TUNING.career.promotion && career.series === next.reached && next.reached < last) {
    promoted = SERIES[next.reached + 1];
    next = { ...next, reached: next.reached + 1, garage: { ...next.garage, [promoted.car]: next.garage[promoted.car] ?? noUpgrades() } };
  }
  const complete = career.series === last && final === 1;
  if (complete) next = { ...next, complete: true };
  return { career: next, position, prize, final: { position: final, bonus, promoted, complete } };
}

/** Start a new season of series `index` (one that's open). */
export function startSeries(career: Career, index: number): Career {
  if (index < 0 || index > career.reached) return career;
  const seasons = career.seasons + 1;
  return { ...career, series: index, seasons, season: seasonFor(index, career.seed * 100 + seasons) };
}

/** Buy the next level of `kind` for `car`: the new career, or null (not your car, top level, not enough money). */
export function buyUpgrade(career: Career, car: string, kind: UpgradeKind): Career | null {
  const current = career.garage[car];
  if (!current) return null;
  const price = upgradePrice(kind, current[kind]);
  if (price === null || price > career.money) return null;
  return { ...career, money: career.money - price, garage: { ...career.garage, [car]: { ...current, [kind]: current[kind] + 1 } } };
}

/** Rounds run of the current season, and how many it has. */
export function careerProgress(career: Career): { round: number; rounds: number } {
  return { round: nextRound(career.season), rounds: career.season.rounds.length };
}

/** A career from saved JSON, or null if it isn't one this version can read. */
export function parseCareer(raw: unknown): Career | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Partial<Career>;
  const index = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < SERIES.length;
  const season = parseSeason(c.season);
  if (
    c.version !== 1 ||
    typeof c.seed !== 'number' ||
    !index(c.reached) ||
    !index(c.series) ||
    (c.series as number) > (c.reached as number) ||
    !Number.isInteger(c.seasons) ||
    !season ||
    typeof c.money !== 'number' ||
    !Number.isFinite(c.money) ||
    c.money < 0 ||
    typeof c.garage !== 'object' ||
    c.garage === null ||
    !Array.isArray(c.best) ||
    c.best.length !== SERIES.length ||
    typeof c.complete !== 'boolean'
  ) {
    return null;
  }
  const garage: Record<string, Upgrades> = {};
  for (const [car, u] of Object.entries(c.garage)) garage[car] = cleanUpgrades(u);
  // The cars of every series reached are yours, whatever the save says.
  for (let i = 0; i <= (c.reached as number); i++) garage[SERIES[i].car] ??= noUpgrades();
  const best = c.best.map((b) => (Number.isInteger(b) && (b as number) >= 1 ? (b as number) : null));
  return { ...(c as Career), season, garage, best };
}
