// The whole simulation in one place: world, cars and lap timers, advanced in fixed steps.
// Headless: tests drive it directly, and the browser game wraps it with input and rendering.
//
// Car 0 is the player's; `car`, `timer`, `previous` and `current` are shorthands for it, so
// a one-car simulation (time trial, the vehicle tests) reads as it always has.

import { PHYSICS_STEP } from './constants';
import { addKinematicCar, createPhysics, type Physics } from './physics';
import type RAPIER from '@dimforge/rapier3d-compat';
import { LapTimer } from './race/timing';
import { nearestSample, type Track, type TrackSample } from './track/track';
import { wetness, type Conditions } from './track/weather';
import { Car, poseOnTrack, type Controls, type Pose } from './vehicle/car';
import { copyPose, createPose, type CarPose } from './vehicle/pose';
import type { CarDef } from './vehicle/carDef';
import { KESTREL } from './vehicle/cars';
import type { AidSettings } from './vehicle/aids';
import type { GearboxMode } from './vehicle/gearbox';

/** The grid (track samples are 2 m apart). A lone car starts on the centreline, 10 m behind the line. */
const GRID = {
  /** Samples behind the line: a lone car, and the front of a race grid. */
  first: 5,
  /** Distance between rows (m), and how much further back the right-hand column stands (m). */
  row: 8,
  stagger: 4,
  /** Each column's distance from the centreline, as a fraction of the half-width. */
  across: 0.45,
};

export interface SimOptions {
  /** How many cars (default 1). Every car uses `carDef`, unless `defs` gives it its own. */
  cars?: number;
  /** A car of its own for the first few cars (the player's, with their setup). */
  defs?: readonly CarDef[];
  /** Grid slot of each car (default: car i in slot i). Slot 0 is pole. */
  slots?: readonly number[];
  /** Cars on the grid, counting other players' (default: `cars`). A car alone starts on the centreline. */
  field?: number;
  /** The weather (default dry). */
  conditions?: Conditions;
}

/** A hard knock this step: for sparks and sounds. */
export interface Contact {
  /** Index into `cars`. */
  car: number;
  against: 'barrier' | 'car';
  /** Where (the middle of the contact points). */
  x: number;
  y: number;
  z: number;
  /** How hard: the contact force's impulse over the step (N·s). */
  impulse: number;
}

/** Another player's car: moved to where it is reported to be, drawn like any car. */
export interface Proxy {
  readonly def: CarDef;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Where it goes on the next step, and where it was before and after the last (for drawing). */
  readonly target: CarPose;
  readonly previous: CarPose;
  readonly current: CarPose;
}

/** One car's poses before and after the last step, for drawing in between. */
export interface CarPoses {
  previous: CarPose;
  current: CarPose;
}

export class Simulation {
  readonly physics: Physics;
  readonly cars: Car[] = [];
  readonly timers: LapTimer[] = [];
  readonly poses: CarPoses[] = [];
  /** Simulation time (s). */
  time = 0;
  steps = 0;
  /** Other players' cars (online), in the order they were added. */
  readonly proxies: Proxy[] = [];
  /** This step's hard knocks (reused objects: copy what you keep). */
  readonly contacts: Contact[] = [];
  private readonly contactPool: Contact[] = [];
  /** Chassis collider handle → car index. */
  private readonly carByCollider = new Map<number, number>();
  private readonly slots: readonly number[];
  private readonly lone: boolean;
  /** The weather, for the whole session. */
  readonly conditions: Conditions;

  constructor(
    readonly track: Track,
    carDef: CarDef = KESTREL,
    options: SimOptions = {},
  ) {
    this.conditions = options.conditions ?? 'dry';
    const wet = wetness(this.conditions);
    this.physics = createPhysics(track, wet >= 1);
    const count = options.cars ?? 1;
    this.slots = options.slots ?? Array.from({ length: count }, (_, i) => i);
    this.lone = (options.field ?? count) === 1;
    for (let i = 0; i < count; i++) {
      const pose = this.gridPose(i);
      this.cars.push(new Car(this.physics, pose, options.defs?.[i] ?? carDef));
      this.cars[i].wetness = wet;
      this.timers.push(new LapTimer(track, pose.position.x, pose.position.z));
      this.poses.push({ previous: createPose(), current: createPose() });
      this.carByCollider.set(this.cars[i].collider.handle, i);
      this.settlePose(i);
    }
  }

  /** The player's car, timer and poses. */
  get car(): Car {
    return this.cars[0];
  }
  get timer(): LapTimer {
    return this.timers[0];
  }
  get previous(): CarPose {
    return this.poses[0].previous;
  }
  get current(): CarPose {
    return this.poses[0].current;
  }

  /** Where car `i` starts: a lone car on the centreline; a field on a staggered two-by-two grid. */
  gridPose(i: number): Pose {
    const { samples } = this.track;
    if (this.lone) return poseOnTrack(samples[samples.length - GRID.first]);
    return this.slotPose(this.slots[i]);
  }

  /** Grid slot `slot` (0 = pole) on the staggered two-by-two grid. */
  slotPose(slot: number): Pose {
    const { samples } = this.track;
    const n = samples.length;
    const spacing = this.track.length / n;
    const right = slot % 2 === 1;
    const back = GRID.first * spacing + Math.floor(slot / 2) * GRID.row + (right ? GRID.stagger : 0);
    const p = samples[n - Math.round(back / spacing)];
    return offsetPose(p, (right ? -1 : 1) * GRID.across * p.halfWidth);
  }

  /** Back to the grid for an out lap; the best laps are kept (and the lap count: a race resets it). */
  restart(): void {
    this.cars.forEach((car, i) => {
      const pose = this.gridPose(i);
      car.reset(pose);
      this.timers[i].restart(pose.position.x, pose.position.z);
      this.settlePose(i);
    });
  }

  /** Add another player's car, at `pose`; returns its index in `proxies`. */
  addProxy(def: CarDef, pose: Pose): number {
    const { body, collider } = addKinematicCar(this.physics, def.halfExtents);
    const proxy: Proxy = { def, body, collider, target: createPose(), previous: createPose(), current: createPose() };
    for (const p of [proxy.target, proxy.previous, proxy.current]) {
      Object.assign(p.position, pose.position);
      Object.assign(p.rotation, pose.rotation);
    }
    body.setTranslation(pose.position, true);
    body.setRotation(pose.rotation, true);
    this.proxies.push(proxy);
    return this.proxies.length - 1;
  }

  /** Where proxy `i` should be after the next step. */
  setProxyPose(i: number, pose: CarPose): void {
    copyPose(pose, this.proxies[i].target);
  }

  /** Make proxy `i` solid (it pushes and can be hit) or a ghost that cars pass through. */
  setProxySolid(i: number, solid: boolean): void {
    const { collider } = this.proxies[i];
    if (collider.isEnabled() !== solid) collider.setEnabled(solid);
  }

  /** One fixed step: `controls` for the player alone, or one per car. */
  step(controls: Controls | readonly Controls[]): void {
    const list = Array.isArray(controls) ? (controls as readonly Controls[]) : null;
    this.cars.forEach((car, i) => {
      copyPose(this.poses[i].current, this.poses[i].previous);
      car.update(list ? list[i] : (controls as Controls), PHYSICS_STEP);
    });
    // Proxies glide to their targets over the step (kinematic: they push, nothing pushes them).
    for (const p of this.proxies) {
      copyPose(p.current, p.previous);
      p.body.setNextKinematicTranslation(p.target.position);
      p.body.setNextKinematicRotation(p.target.rotation);
      copyPose(p.target, p.current);
    }
    this.physics.world.step(this.physics.events);
    this.collectContacts();
    this.time += PHYSICS_STEP;
    this.steps++;
    this.cars.forEach((car, i) => {
      car.capturePose(this.poses[i].current);
      const p = car.position;
      this.timers[i].update(p.x, p.z, this.time, this.isOffTrack(i));
    });
  }

  /**
   * Track limits: every wheel touching the ground is beyond the kerbs (on grass or gravel).
   * Kerbs count as track; a wheel in the air doesn't decide either way.
   */
  isOffTrack(i: number): boolean {
    const wheels = this.cars[i].wheels;
    return wheels.some((w) => w.contact) && wheels.every((w) => !w.contact || w.surface === 'grass' || w.surface === 'gravel');
  }

  /** The player's car is beyond the track limits. */
  get offTrack(): boolean {
    return this.isOffTrack(0);
  }

  /** Put car `i` back on the track at the nearest point, facing the right way, stopped. Voids the lap. */
  recover(i = 0): void {
    this.timers[i].invalidate();
    const p = this.cars[i].position;
    const k = nearestSample(this.track, p.x, p.z, this.timers[i].index);
    this.cars[i].reset(poseOnTrack(this.track.samples[k]));
    this.settlePose(i);
  }

  /** Turn this step's contact force events into `contacts`: one per car in each knock. */
  private collectContacts(): void {
    this.contacts.length = 0;
    const { world, events, tags } = this.physics;
    events.drainContactForceEvents((e) => {
      const h1 = e.collider1();
      const h2 = e.collider2();
      const impulse = e.totalForceMagnitude() * PHYSICS_STEP;
      // Where: the middle of the solver's contact points, if it has any.
      let x = 0;
      let y = 0;
      let z = 0;
      let n = 0;
      world.contactPair(world.getCollider(h1), world.getCollider(h2), (m) => {
        for (let k = 0; k < m.numSolverContacts(); k++) {
          const p = m.solverContactPoint(k);
          if (!p) continue;
          x += p.x;
          y += p.y;
          z += p.z;
          n++;
        }
      });
      for (const [mine, other] of [
        [h1, h2],
        [h2, h1],
      ]) {
        const car = this.carByCollider.get(mine);
        if (car === undefined) continue;
        const otherTag = tags.get(other);
        if (otherTag !== 'barrier' && otherTag !== 'car') continue;
        const at = n > 0 ? { x: x / n, y: y / n, z: z / n } : this.cars[car].position;
        const c = this.contactPool[this.contacts.length] ?? (this.contactPool[this.contacts.length] = { car: 0, against: 'barrier', x: 0, y: 0, z: 0, impulse: 0 });
        c.car = car;
        c.against = otherTag;
        c.x = at.x;
        c.y = at.y;
        c.z = at.z;
        c.impulse = impulse;
        this.contacts.push(c);
      }
    });
  }

  /** Make both of car `i`'s poses its pose now, so a teleport isn't drawn as a slide. */
  private settlePose(i: number): void {
    this.cars[i].capturePose(this.poses[i].current);
    copyPose(this.poses[i].current, this.poses[i].previous);
  }

  /** Switch ABS and traction control on or off (the player's car). */
  setAids(aids: AidSettings, i = 0): void {
    this.cars[i].aids = { ...aids };
  }

  /** Switch between the automatic and manual gearbox (the player's car). */
  setGearboxMode(mode: GearboxMode, i = 0): void {
    this.cars[i].drivetrain.setMode(mode);
  }
}

/** The pose at sample `p`, moved `offset` metres to the left across the banked road. */
function offsetPose(p: TrackSample, offset: number): Pose {
  const pose = poseOnTrack(p);
  pose.position.x += p.lx * offset;
  pose.position.y += p.ly * offset;
  pose.position.z += p.lz * offset;
  return pose;
}
