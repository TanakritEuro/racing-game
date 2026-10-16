import { describe, expect, it } from 'vitest';
import {
  ENTRIES,
  gridSlots,
  newSeason,
  nextRound,
  parseSeason,
  pointsFor,
  POINTS,
  recordRound,
  roundConditions,
  roundRace,
  ROUNDS,
  seasonOver,
  standings,
  type Season,
} from '../src/race/championship';

/** Finishing orders, winner first. */
const IN_ORDER = [0, 1, 2, 3, 4, 5, 6, 7];

describe('championship', () => {
  it('has four rounds, shortest first, and points for the top eight', () => {
    expect(ROUNDS.map((r) => r.track)).toEqual(['proving-ground', 'saltmarsh', 'ridgeback', 'harrowmere']);
    expect(POINTS).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(pointsFor(1)).toBe(10);
    expect(pointsFor(8)).toBe(1);
    expect(pointsFor(9)).toBe(0);
  });

  it('draws the field once: the same skills for the same seed, all season', () => {
    const a = newSeason(42, 'hard', 'Kestrel');
    const b = newSeason(42, 'hard', 'Kestrel');
    expect(a.skills).toEqual(b.skills);
    expect(a.skills[0]).toBeNull();
    expect(a.skills.slice(1).every((s) => s !== null)).toBe(true);
    expect(newSeason(43, 'hard', 'Kestrel').skills).not.toEqual(a.skills);
    const after = recordRound(a, IN_ORDER);
    expect(after.skills).toEqual(a.skills);
  });

  it('adds up points, and breaks ties on wins, then seconds, then the last round', () => {
    let s = newSeason(1, 'medium', 'Kestrel');
    s = recordRound(s, IN_ORDER); // 0 wins, 1 second
    s = recordRound(s, [1, 0, 2, 3, 4, 5, 6, 7]); // 1 wins, 0 second
    const rows = standings(s);
    // 0 and 1 both have 18 points and one win each, one second each: the later round decides (1 won it).
    expect(rows[0].points).toBe(18);
    expect(rows[1].points).toBe(18);
    expect(rows[0].entry).toBe(1);
    expect(rows[0].lastRound).toBe(10);
    expect(rows[1].lastRound).toBe(8);
    // More wins beats more seconds on equal points.
    let t = newSeason(1, 'medium', 'Kestrel');
    t = recordRound(t, [2, 3, 0, 1, 4, 5, 6, 7]); // 2: 10, 3: 8
    t = recordRound(t, [3, 4, 5, 2, 0, 1, 6, 7]); // 3: 10, 2: 5 → 2: 15, 3: 18
    t = recordRound(t, [6, 2, 4, 5, 0, 1, 7, 3]); // 2: 8 → 23; 3: 0 → 18
    expect(standings(t)[0].entry).toBe(2);
    // Every round hands out 39 points.
    expect(standings(t).reduce((sum, r) => sum + r.points, 0)).toBe(3 * 39);
  });

  it('puts you mid-grid in round 1, then the leader last', () => {
    let s = newSeason(5, 'easy', 'Wren');
    const first = gridSlots(s);
    expect(first[0]).toBe(Math.floor(ENTRIES / 2));
    expect(new Set(first).size).toBe(ENTRIES);
    s = recordRound(s, [3, 0, 1, 2, 4, 5, 6, 7]);
    const second = gridSlots(s);
    expect(second[3]).toBe(ENTRIES - 1); // the leader starts last
    expect(second[7]).toBe(0); // the last-placed on pole
    expect(new Set(second).size).toBe(ENTRIES);
  });

  it('draws each round’s weather from the season: the same every time, some wet and some damp', () => {
    const a = newSeason(42, 'hard', 'Kestrel');
    expect(a.rounds.map((_, r) => roundConditions(a, r))).toEqual(newSeason(42, 'hard', 'Kestrel').rounds.map((_, r) => roundConditions(a, r)));
    expect(roundRace(a).options.conditions).toBe(roundConditions(a, 0));
    const counts = { dry: 0, damp: 0, wet: 0 };
    for (let seed = 1; seed <= 400; seed++) {
      const s = newSeason(seed, 'medium', 'Kestrel');
      s.rounds.forEach((_, r) => counts[roundConditions(s, r)]++);
    }
    // One in four wet, one in four damp, give or take.
    expect(counts.wet / 1600).toBeGreaterThan(0.2);
    expect(counts.wet / 1600).toBeLessThan(0.3);
    expect(counts.damp / 1600).toBeGreaterThan(0.2);
    expect(counts.damp / 1600).toBeLessThan(0.3);
  });

  it('ends after four rounds and takes no more results', () => {
    let s = newSeason(9, 'medium', 'Harrier');
    for (let r = 0; r < 4; r++) {
      expect(nextRound(s)).toBe(r);
      expect(seasonOver(s)).toBe(false);
      s = recordRound(s, IN_ORDER);
    }
    expect(seasonOver(s)).toBe(true);
    expect(recordRound(s, IN_ORDER).results).toHaveLength(4);
  });

  it('saves as JSON and refuses what it cannot read', () => {
    const s = recordRound(newSeason(7, 'hard', 'Kestrel'), IN_ORDER);
    expect(parseSeason(JSON.parse(JSON.stringify(s)))).toEqual(s);
    const broken: Partial<Season>[] = [
      { ...s, version: 2 as 1 },
      { ...s, results: [[0, 1, 2]] },
      { ...s, results: [[0, 0, 1, 2, 3, 4, 5, 6]] },
      { ...s, skills: s.skills.slice(1) },
      { ...s, difficulty: 'insane' as 'hard' },
    ];
    for (const b of broken) expect(parseSeason(JSON.parse(JSON.stringify(b)))).toBeNull();
    expect(parseSeason('nonsense')).toBeNull();
    expect(parseSeason(null)).toBeNull();
  });
});
