// Racing in traffic. Every car's place on the track in track coordinates (distance round the
// lap, metres left of the centreline, speed), and for each AI driver what to do about the cars
// near it: follow a slower car, move to the side with room to pass it, or keep a car's width
// from a car alongside. It only sets the driver's lateral aim and a cap on its speed;
// steering and speed control stay the driver's own. It never blocks or defends. Pure simulation.

import { TUNING } from '../config';
import { clamp, type Vec3 } from '../math';
import { lateralOffset, nearestSample, type Track } from '../track/track';
import type { CarDef } from '../vehicle/carDef';
import type { AiDriver } from './driver';

/** A car as traffic sees it: a simulated `Car`, or another player's car (online). */
export interface Mover {
  readonly position: Vec3;
  /** Forward speed (m/s). */
  readonly speed: number;
}

export interface TrackPosition {
  /** Nearest track sample. */
  index: number;
  /** Distance round the lap from the start line (m). */
  distance: number;
  /** Metres left of the centreline (negative = right). */
  lateral: number;
  /** Forward speed (m/s). */
  speed: number;
}

export class Traffic {
  readonly positions: TrackPosition[];
  /** Where each car wants to be across the road while in traffic (m left of the centreline), or null on its line. */
  private readonly side: (number | null)[];
  private readonly length: number;
  private readonly width: number;
  private readonly carLength: number;

  /** `def`: the car whose size sets the gaps kept. */
  constructor(
    readonly track: Track,
    cars: readonly Mover[],
    def: CarDef,
  ) {
    this.positions = cars.map(() => ({ index: -1, distance: 0, lateral: 0, speed: 0 }));
    this.side = cars.map(() => null);
    this.length = track.length;
    this.width = 2 * def.halfExtents.x;
    this.carLength = 2 * def.halfExtents.z;
  }

  /** Back to the grid: every car on its own line again. */
  reset(): void {
    this.side.fill(null);
    for (const p of this.positions) p.index = -1;
  }

  /** Every car's place on the track. Call after each step. */
  update(cars: readonly Mover[]): void {
    const { track } = this;
    const spacing = track.length / track.samples.length;
    cars.forEach((car, k) => {
      const pos = this.positions[k];
      const p = car.position;
      pos.index = nearestSample(track, p.x, p.z, pos.index < 0 ? undefined : pos.index);
      const s = track.samples[pos.index];
      // Along the tangent from the nearest sample, for distance finer than the 2 m samples.
      const along = (p.x - s.x) * s.tx + (p.z - s.z) * s.tz;
      pos.distance = (((pos.index * spacing + along) % this.length) + this.length) % this.length;
      pos.lateral = lateralOffset(track, pos.index, p.x, p.z);
      pos.speed = car.speed;
    });
  }

  /**
   * Set `driver`'s aim and speed cap for car `me` from the cars around it. `firstLap`: more
   * careful (the field is bunched up). `dt` is the step (s).
   */
  advise(me: number, driver: AiDriver, dt: number, firstLap = false): void {
    const T = TUNING.ai.traffic;
    const { positions, carLength, width } = this;
    const mine = positions[me];
    // Not placed on the track yet (update() hasn't run): no advice.
    if (mine.index < 0) return;
    const v = Math.max(mine.speed, 1);
    const line = driver.line;
    const lineLat = line.offset[mine.index];
    const aggression = driver.skill.aggression * (firstLap ? T.firstLap.aggression : 1);
    const followTime = T.followTime * (firstLap ? T.firstLap.followTime : 1);
    const look = Math.max(T.minLook, T.lookTime * v);
    const apart = width + T.clearance;
    // Where it means to be across the road this step: where traffic put it, else on its line
    // (or where it is, when well off its line: on the grid, or put back on the track).
    const from = this.side[me] ?? (Math.abs(mine.lateral - lineLat) > T.offLine ? mine.lateral : lineLat + driver.aim);
    let want = from;
    let busy = false;
    let cap = Infinity;

    for (let j = 0; j < positions.length; j++) {
      if (j === me) continue;
      const other = positions[j];
      let gap = other.distance - mine.distance;
      if (gap > this.length / 2) gap -= this.length;
      if (gap < -this.length / 2) gap += this.length;
      if (gap < -carLength - T.clearBehind || gap > look) continue;
      const lat = other.lateral;
      // A car off the road or nearly stopped (spun, crashed) is driven round, never followed.
      const racing = other.speed > T.racingSpeed && Math.abs(lat) < this.track.samples[other.index].halfWidth + 1;

      if (gap < carLength + 1) {
        // Alongside, or just past it: stay a car's width (and some) away from it, on whichever
        // side it is already, rather than turn across its nose.
        if (Math.abs(lat - want) < apart) {
          busy = true;
          want = mine.lateral >= lat ? lat + apart : lat - apart;
        }
        // Overlapping it already, and it is (even slightly) ahead: concede, and drop in behind.
        if (racing && gap > 0 && Math.abs(lat - mine.lateral) < apart) cap = Math.min(cap, Math.max(0, other.speed - T.concede));
        continue;
      }

      // Ahead. Only a car in its path, that it is catching, matters.
      const closing = v - other.speed;
      const clear = gap - carLength;
      const reach = clear / Math.max(closing, 0.1);
      if (Math.abs(lat - want) >= apart || (reach > T.reactTime && clear > followTime * v + T.followGap)) continue;
      busy = true;
      // A side to pass on: room beside it (with some to spare, less the bolder the driver), nearest first.
      const spare = T.boldness * (1 - aggression);
      const left = lat + apart;
      const right = lat - apart;
      const roomLeft = line.left[other.index] - left >= spare;
      const roomRight = right - line.right[other.index] >= spare;
      const sides = [left, right].filter((s) => (s === left ? roomLeft : roomRight)).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
      if (sides.length > 0) want = sides[0];
      // Until it is beside it, follow: close to the following gap, no faster.
      if (racing && Math.abs(lat - mine.lateral) < apart) {
        const gapWanted = followTime * v + T.followGap;
        cap = Math.min(cap, Math.max(0, other.speed + T.followGain * (clear - gapWanted)));
      }
    }

    // Move across at a steady rate: towards the traffic's spot, or back to the line once clear.
    // Never off the road for traffic: beside a car that is itself off, it concedes or follows instead.
    const to = busy ? clamp(want, line.right[mine.index], line.left[mine.index]) : lineLat;
    const step = T.sideRate * dt;
    const next = from + clamp(to - from, -step, step);
    this.side[me] = busy || Math.abs(next - lineLat) > step ? next : null;
    driver.aim = (this.side[me] ?? lineLat) - lineLat;
    driver.speedCap = cap;
  }
}
