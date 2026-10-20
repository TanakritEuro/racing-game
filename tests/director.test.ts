// The replay's director, and the replay player over a race: synthetic races where each car's
// progress is a function of time, with moments placed by hand.

import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import { RaceRecorder, type RaceMoment, type RaceRecording } from '../src/race/raceRecording';
import { createRecordedState } from '../src/race/recording';
import { Director, type Shot } from '../src/replay/director';
import { Replay } from '../src/replay/replay';

const D = TUNING.replay.director;
/** Laps a second at full pace: a 50 s lap. */
const PACE = 1 / 50;

/** `seconds` of race with each car's progress from `progress(car, t)`, and `moments`. */
function race(cars: number, seconds: number, progress: (car: number, t: number) => number, moments: Omit<RaceMoment, 'lap'>[] = []): RaceRecording {
  const rec = new RaceRecorder('t', Array.from({ length: cars }, () => 'Kestrel'), 3);
  const states = Array.from({ length: cars }, () => createRecordedState());
  const p = new Array<number>(cars);
  for (let i = 0; i <= seconds / PHYSICS_STEP; i++) {
    for (let k = 0; k < cars; k++) p[k] = progress(k, i * PHYSICS_STEP);
    rec.capture(states, p);
  }
  for (const m of moments) rec.moment({ ...m, lap: 1 });
  return rec.recording();
}

/** Every distinct shot over the race, playing at 30 Hz. */
function shots(rec: RaceRecording, player: number | null, tvSees?: (i: number) => boolean): Shot[] {
  const d = new Director(rec, player, 1000, tvSees);
  const out: Shot[] = [];
  for (let t = 0; t <= rec.duration; t += 1 / 30) {
    const s = d.at(t);
    const last = out[out.length - 1];
    if (!last || last.car !== s.car || last.camera !== s.camera) out.push(s);
    else out[out.length - 1] = s;
  }
  return out;
}

/** Spread out: car k is k × 3 s behind the leader (already on the move). */
const spread = (k: number, t: number) => (t + 10 - 3 * k) * PACE;

describe('the director', () => {
  it('follows you when nothing is going on, and the leader once you are done or not there', () => {
    const rec = race(4, 30, spread);
    for (const s of shots(rec, 2)) expect(s.car).toBe(2);
    for (const s of shots(rec, null)) expect(s.car).toBe(0);
  });

  it('follows the attacker in a battle near the front, over a lone leader and you', () => {
    // Cars 1 and 2 half a second apart; everyone else well spread.
    const rec = race(4, 30, (k, t) => (k === 2 ? (t + 10 - 3.5) * PACE : spread(k, t)));
    const all = shots(rec, 3);
    expect(all.every((s) => s.car === 2 && s.reason === 'battle')).toBe(true);
  });

  it('shows a pass from a few seconds before it, on the car making it', () => {
    const rec = race(4, 40, spread, [{ kind: 'pass', time: 20, cars: [3, 2] }]);
    const all = shots(rec, 1);
    const pass = all.find((s) => s.moment?.kind === 'pass')!;
    expect(pass.car).toBe(3);
    expect(pass.from).toBeLessThanOrEqual(20 - D.lead + D.minShot);
    expect(pass.until).toBeGreaterThanOrEqual(20 + D.after);
  });

  it('holds every shot its minimum, and cuts in for a spin but not for a fastest lap', () => {
    const rec = race(5, 60, spread, [
      { kind: 'fastestLap', time: 10, cars: [4] },
      { kind: 'spin', time: 25, cars: [3] },
      { kind: 'contact', time: 26, cars: [1] },
      { kind: 'finish', time: 50, cars: [0], value: 1 },
    ]);
    const all = shots(rec, 2);
    for (let i = 0; i + 1 < all.length; i++) expect(all[i + 1].from - all[i].from).toBeGreaterThanOrEqual(D.minShot - 1e-6);
    const spin = all.find((s) => s.moment?.kind === 'spin')!;
    expect(spin.car).toBe(3);
    // Not from inside a spinning car.
    expect(spin.camera).not.toBe('onboard');
    expect(all.some((s) => s.moment?.kind === 'finish' && s.car === 0)).toBe(true);
    // The lower-interest fastest lap only shows when nothing better is on: here it did, between quiet shots.
    expect(all.filter((s) => s.moment?.kind === 'fastestLap').length).toBeLessThanOrEqual(1);
  });

  it('films from the car where no trackside camera sees, and from the car every few shots', () => {
    const rec = race(4, 60, spread, [10, 20, 30, 40, 50].map((time, i) => ({ kind: 'pass' as const, time, cars: [1 + (i % 3), 0] })));
    const blind = shots(rec, 0, () => false);
    expect(blind.every((s) => s.camera !== 'tv')).toBe(true);
    const seen = shots(rec, 0);
    expect(seen.some((s) => s.camera === 'tv')).toBe(true);
    expect(seen.some((s) => s.camera !== 'tv')).toBe(true);
  });

  it('starts afresh after a seek, the same as playing up to it', () => {
    const rec = race(4, 40, spread, [{ kind: 'spin', time: 30, cars: [2] }]);
    const d = new Director(rec, 0, 1000);
    d.at(1);
    expect(d.at(29).car).toBe(2);
    expect(d.at(5).car).toBe(0);
  });
});

describe('a race replay', () => {
  it('plays the race through, and jumps between its moments', () => {
    const rec = race(3, 40, spread, [
      { kind: 'start', time: 0, cars: [] },
      { kind: 'pass', time: 12, cars: [1, 0] },
      { kind: 'spin', time: 30, cars: [2] },
    ]);
    const r = new Replay();
    r.playRace(rec, 'RACE');
    expect(r.active).toBe(true);
    expect(r.race).toBe(rec);
    expect(r.recording).toBeNull();
    expect(r.length).toBeCloseTo(rec.duration, 9);
    // The start isn't a moment to jump to; the pass and the spin are, landing just before each.
    expect(r.raceMoments.map((m) => m.kind)).toEqual(['pass', 'spin']);
    expect(r.nextMoment()!.kind).toBe('pass');
    expect(r.time).toBeCloseTo(12 - TUNING.replay.jumpLead, 9);
    expect(r.nextMoment()!.kind).toBe('spin');
    expect(r.nextMoment()).toBeNull();
    expect(r.previousMoment()!.kind).toBe('pass');
    expect(r.previousMoment()).toBeNull();
    r.seek(1e6);
    expect(r.time).toBeCloseTo(rec.duration, 9);
    expect(r.update(1)).toBeCloseTo(rec.duration, 9);
    expect(r.update(1)).toBeNull();
    expect(r.active).toBe(false);
  });
});
