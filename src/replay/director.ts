// The replay's director: at each moment of a race replay, which car to follow and from where,
// as television would. A moment (a pass, a spin, a stop, a finish) is shown from a few seconds
// before it; otherwise the closest battle near the front; otherwise you (or the leader). Every
// shot runs a minimum length, and every few shots come from the car rather than the trackside
// cameras. Works from the recording alone, so a seek simply starts afresh. Pure.

import { TUNING } from '../config';
import { sampleIndexAt, standingsAt, type RaceMoment, type RaceRecording } from '../race/raceRecording';

export type ShotCamera = 'tv' | 'chase' | 'onboard';

export interface Shot {
  car: number;
  camera: ShotCamera;
  /** Race time the shot began, and the earliest it may end (s). */
  from: number;
  until: number;
  /** Why this car: the moment shown, a battle, or nothing else going on. */
  reason: 'moment' | 'battle' | 'quiet';
  /** The moment, when it is one; how much it was worth showing. */
  moment: RaceMoment | null;
  interest: number;
}

export class Director {
  private shot: Shot | null = null;
  private last = -Infinity;
  private shots = 0;

  /**
   * `player`: your car, followed when nothing else is going on (null: the leader is);
   * `tvSees(car, sample)`: whether a trackside camera covers that stretch of track.
   */
  constructor(
    private readonly rec: RaceRecording,
    private readonly player: number | null,
    private readonly samples: number,
    private readonly tvSees: (sample: number) => boolean = () => true,
  ) {}

  /** The shot at race time `t` (call with the replay's time as it plays; a jump starts afresh). */
  at(t: number): Shot {
    const D = TUNING.replay.director;
    // A seek: back, or further forward than playback goes: choose afresh.
    if (t < this.last || t > this.last + 1) this.shot = null;
    this.last = t;
    const shot = this.shot;
    if (shot && t < shot.until) {
      // A moment worth cutting in for, once the shot has had its minimum.
      if (t - shot.from >= D.minShot) {
        const m = this.moment(t);
        if (m && m.interest >= D.cutIn && m.interest > shot.interest && m.moment !== shot.moment) return this.cut(t, m.car, 'moment', m.moment, m.interest, m.until);
      }
      return shot;
    }
    const m = this.moment(t);
    if (m) return this.cut(t, m.car, 'moment', m.moment, m.interest, m.until);
    const battle = this.battle(t);
    if (battle !== null) return this.cut(t, battle, 'battle', null, 2, t + D.hold);
    return this.cut(t, this.quiet(t), 'quiet', null, 0, t + D.hold);
  }

  private cut(t: number, car: number, reason: Shot['reason'], moment: RaceMoment | null, interest: number, until: number): Shot {
    const D = TUNING.replay.director;
    // The same car again carries on with the same camera (no cut for nothing).
    const same = this.shot && this.shot.car === car;
    let camera: ShotCamera;
    if (same) camera = this.shot!.camera;
    else {
      this.shots++;
      const inCar = this.shots % D.inCarEvery === 0 || !this.tvSees(sampleIndexAt(this.rec, car, t, this.samples));
      // Onboard a spinning car is no use to anyone: chase it instead.
      camera = inCar ? (moment?.kind === 'spin' || moment?.kind === 'contact' ? 'chase' : 'onboard') : 'tv';
    }
    this.shot = { car, camera, from: same ? this.shot!.from : t, until: Math.max(until, t + D.minShot), reason, moment, interest };
    return this.shot;
  }

  /** The most interesting moment due on screen at `t` (from `lead` before it to `after` after), if any. */
  private moment(t: number): { moment: RaceMoment; car: number; interest: number; until: number } | null {
    const D = TUNING.replay.director;
    let best: { moment: RaceMoment; car: number; interest: number; until: number } | null = null;
    for (const m of this.rec.moments) {
      if (m.time < t - D.after || m.cars.length === 0) continue;
      if (m.time > t + D.lead) break;
      let interest = D.interest[m.kind];
      if (m.kind === 'finish' && m.value === 1) interest += D.winner;
      if (interest <= 0) continue;
      // Sooner is better, between equals.
      const score = interest - Math.abs(m.time - t) * 0.1;
      if (!best || score > best.interest - Math.abs(best.moment.time - t) * 0.1) best = { moment: m, car: m.cars[0], interest, until: m.time + D.after };
    }
    return best;
  }

  /** The car attacking in the closest-to-the-front battle at `t`, if there is one. */
  private battle(t: number): number | null {
    const rows = standingsAt(this.rec, t);
    for (let i = 1; i < rows.length; i++) {
      const ahead = rows[i - 1];
      const behind = rows[i];
      if (ahead.finished || behind.finished) continue;
      if (behind.gap - ahead.gap < TUNING.replay.director.battleGap) return behind.car;
    }
    return null;
  }

  /** Nothing going on: you while you're racing, or the leader. */
  private quiet(t: number): number {
    const rows = standingsAt(this.rec, t);
    const mine = rows.find((r) => r.car === this.player);
    return mine && !mine.finished ? mine.car : rows[0].car;
  }
}

/** The moments worth jumping between in a replay (not the start or the last lap's call). */
export function jumpMoments(rec: RaceRecording): RaceMoment[] {
  return rec.moments.filter((m) => m.cars.length > 0 && TUNING.replay.director.interest[m.kind] > 0);
}
