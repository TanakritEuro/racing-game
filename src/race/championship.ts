// A championship: four rounds against the same seven AI drivers, with points, standings and
// a grid for each round. Entry k is car k in every round's race (0 is the player), so a
// driver's name and colour follow its entry; its skill is drawn once for the whole season.
// Pure data and functions; saved as plain JSON.

import { fieldSkills, type Difficulty, type Skill } from '../ai/skill';
import { TUNING } from '../config';
import { createRng } from '../math';
import type { Conditions } from '../track/weather';
import { WEAR_RATES, type WearRate } from '../vehicle/wear';
import { AI_NAMES, type RaceOptions, type Standing } from './race';

/** The rounds, shortest first. */
export const ROUNDS: readonly { track: string; laps: number }[] = [
  { track: 'proving-ground', laps: 5 },
  { track: 'saltmarsh', laps: 3 },
  { track: 'ridgeback', laps: 3 },
  { track: 'harrowmere', laps: 3 },
];

/** Points for first to eighth. */
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

/** Entries in a season: you and every AI driver. */
export const ENTRIES = 1 + AI_NAMES.length;

export interface Season {
  version: 1;
  seed: number;
  difficulty: Difficulty;
  /** The car everyone drives. */
  car: string;
  /** Each entry's skill, the same all season (null for the player, entry 0). */
  skills: (Skill | null)[];
  rounds: { track: string; laps: number }[];
  /** Each finished round's finishing order: entry numbers, winner first. */
  results: number[][];
  /** Weather drawn per round (default yes), or always dry; how fast tyres wear (default normal). */
  weather?: boolean;
  wear?: WearRate;
}

/** A season's own rounds and conditions (a career series), instead of the championship's. */
export interface SeasonOptions {
  rounds?: readonly { track: string; laps: number }[];
  weather?: boolean;
  wear?: WearRate;
}

export interface SeasonStanding {
  entry: number;
  points: number;
  /** Points scored in the latest round. */
  lastRound: number;
  /** Finishing position (1-based) in each round so far. */
  finishes: number[];
}

export function newSeason(seed: number, difficulty: Difficulty, car: string, options: SeasonOptions = {}): Season {
  const skills = fieldSkills(difficulty, ENTRIES - 1, createRng(seed));
  const season: Season = { version: 1, seed, difficulty, car, skills: [null, ...skills], rounds: (options.rounds ?? ROUNDS).map((r) => ({ ...r })), results: [] };
  if (options.weather !== undefined) season.weather = options.weather;
  if (options.wear !== undefined) season.wear = options.wear;
  return season;
}

/** The round to run next (0-based), or the number of rounds once the season is over. */
export function nextRound(season: Season): number {
  return season.results.length;
}

export function seasonOver(season: Season): boolean {
  return season.results.length >= season.rounds.length;
}

/** Points for finishing in `position` (1-based). */
export function pointsFor(position: number): number {
  return POINTS[position - 1] ?? 0;
}

/** A finished round's order (entry numbers, winner first) added to the season. */
export function recordRound(season: Season, order: readonly number[]): Season {
  if (seasonOver(season)) return season;
  return { ...season, results: [...season.results, [...order]] };
}

/**
 * The standings: most points first; ties to more wins, then more second places and so on,
 * then the better finish in the latest round, then the entry number.
 */
export function standings(season: Season): SeasonStanding[] {
  const rows: SeasonStanding[] = Array.from({ length: ENTRIES }, (_, entry) => ({ entry, points: 0, lastRound: 0, finishes: [] }));
  season.results.forEach((order, r) => {
    order.forEach((entry, i) => {
      const row = rows[entry];
      if (!row) return;
      row.points += pointsFor(i + 1);
      row.finishes.push(i + 1);
      if (r === season.results.length - 1) row.lastRound = pointsFor(i + 1);
    });
  });
  const count = (row: SeasonStanding, position: number) => row.finishes.filter((f) => f === position).length;
  const last = (row: SeasonStanding) => row.finishes[row.finishes.length - 1] ?? Infinity;
  return rows.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    for (let p = 1; p <= ENTRIES; p++) {
      const d = count(b, p) - count(a, p);
      if (d !== 0) return d;
    }
    return last(a) - last(b) || a.entry - b.entry;
  });
}

/**
 * The grid slot of each entry (index = entry) for the next round: round 1 has you in the
 * middle and the AI in order around you; after that, reverse championship order, so the
 * leader starts last.
 */
export function gridSlots(season: Season): number[] {
  const slots = new Array<number>(ENTRIES);
  if (season.results.length === 0) {
    const you = Math.floor(ENTRIES / 2);
    slots[0] = you;
    let s = 0;
    for (let entry = 1; entry < ENTRIES; entry++) {
      if (s === you) s++;
      slots[entry] = s++;
    }
    return slots;
  }
  standings(season).forEach((row, i) => (slots[row.entry] = ENTRIES - 1 - i));
  return slots;
}

/** The seed for round `r`'s race (its lights and the AI's mistakes). */
export function roundSeed(season: Season, r: number): number {
  return season.seed * 10 + r + 1;
}

/** The next round's race: its circuit, and the options that build it from the season. */
/** Round r's weather, drawn from the season's seed: some rounds wet, some damp. */
export function roundConditions(season: Season, r: number): Conditions {
  if (season.weather === false) return 'dry';
  const W = TUNING.race.seasonWeather;
  const x = createRng(roundSeed(season, r) * 7 + 3)();
  return x < W.wet ? 'wet' : x < W.wet + W.damp ? 'damp' : 'dry';
}

export function roundRace(season: Season): { track: string; options: RaceOptions } {
  const r = Math.min(nextRound(season), season.rounds.length - 1);
  const round = season.rounds[r];
  return {
    track: round.track,
    options: {
      conditions: roundConditions(season, r),
      // The championship's tyres wear as normal (its rounds are sprints: a stop only pays if you
      // ruin a set); a career series sets its own.
      wear: season.wear ?? 'normal',
      opponents: ENTRIES - 1,
      laps: round.laps,
      difficulty: season.difficulty,
      seed: roundSeed(season, r),
      slots: gridSlots(season),
      skills: season.skills,
    },
  };
}

/** A race's finishing order (entry numbers, winner first) from its final standings. */
export function finishingOrder(rows: readonly Standing[]): number[] {
  return [...rows].sort((a, b) => a.position - b.position).map((r) => r.car);
}

/** A season from saved JSON, or null if it isn't one this version can read. */
export function parseSeason(raw: unknown): Season | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Partial<Season>;
  const isOrder = (o: unknown) => Array.isArray(o) && o.length === ENTRIES && new Set(o).size === ENTRIES && o.every((e) => Number.isInteger(e) && e >= 0 && e < ENTRIES);
  if (
    s.version !== 1 ||
    typeof s.seed !== 'number' ||
    !['easy', 'medium', 'hard'].includes(s.difficulty as string) ||
    typeof s.car !== 'string' ||
    !Array.isArray(s.skills) ||
    s.skills.length !== ENTRIES ||
    s.skills[0] !== null ||
    !s.skills.slice(1).every((k) => typeof k === 'object' && k !== null && typeof (k as Skill).pace === 'number') ||
    !Array.isArray(s.rounds) ||
    !s.rounds.every((r) => typeof r?.track === 'string' && Number.isInteger(r?.laps)) ||
    !Array.isArray(s.results) ||
    s.results.length > s.rounds.length ||
    !s.results.every(isOrder) ||
    (s.weather !== undefined && typeof s.weather !== 'boolean') ||
    (s.wear !== undefined && !WEAR_RATES.includes(s.wear))
  ) {
    return null;
  }
  return s as Season;
}
