// The car: a Rapier rigid body for the chassis, with four raycast wheels whose suspension
// and tyre forces are computed here each physics step and applied to the chassis.
//
// Pure simulation: no Three.js, DOM or audio. The presentation reads `wheels` (with their steer angles)
// and the chassis transform after each step.
//
// Per physics step:
//   1. Suspension: a ray from each mount finds the ground; spring, bump/rebound damping and
//      bump stop give the tyre's load, so weight transfer emerges on its own.
//   2. Substeps (TUNING.tyreIntegration.substeps), with the chassis velocities frozen: tyre
//      forces from the relaxed slip (Pacejka curves, `tyre.ts`), wheel spin from drive,
//      brake and tyre torques (`spin.ts`), then the relaxed slip moves towards the new
//      slip (first-order relaxation: the slip builds up over a distance rolled).
//   3. The substeps' average tyre forces are applied at the contact points, plus aero drag.
//
// The driven wheels (rear, front or all four, `CarDef.drivetrain`) turn with the engine through
// the drivetrain (`drivetrain.ts`): engine, clutch, gearbox and differentials.

import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config';
import { AIR_DENSITY } from '../constants';
import { clamp, quatFromBasis, type Quat, type Vec3 } from '../math';
import { CAR_GROUPS, WHEEL_QUERY_GROUPS, type Physics, type SurfaceTag } from '../physics';
import type { TrackSample } from '../track/track';
import type { CarDef, TyreDef } from './carDef';
import { KESTREL } from './cars';
import type { CarPose } from './pose';
import { Drivetrain, type DriveOut } from './drivetrain';
import { REVERSE } from './gearbox';
import { absStep, tcStep, type AidSettings } from './aids';
import { spinFree, type SpinBody } from './spin';
import { rackStep, wheelSteerAngle } from './steering';
import { gripLimit, prepareTyre, tyreForces, type PreparedTyre, type TyreForce } from './tyre';
import { surfaceGrip } from '../track/weather';
import { fuelBurned, patchPower, wearGrip } from './wear';
import { engineTorque } from './engine';

/** One step's driver inputs. Keyboard, gamepad and AI drivers all produce these. */
export interface Controls {
  /** 0–1 */
  throttle: number;
  /** 0–1. Held at a standstill it engages reverse. */
  brake: number;
  /** -1 (full left) to +1 (full right). */
  steer: number;
  /** Clutch pedal: 0 = up (engaged) to 1 = pressed. Combined with the automatic clutch. */
  clutch: number;
  /** A gear change requested for this step only: -1 down, +1 up. */
  shift: -1 | 0 | 1;
  /** 0–1: brakes the rear wheels only, past ABS, and lets the automatic clutch go. */
  handbrake: number;
}

export const NO_CONTROLS: Readonly<Controls> = { throttle: 0, brake: 0, steer: 0, clutch: 0, shift: 0, handbrake: 0 };

/** `c` as it is, or with any value that isn't a finite number replaced by 0. */
function finiteControls(c: Controls): Controls {
  if (Number.isFinite(c.throttle) && Number.isFinite(c.brake) && Number.isFinite(c.steer) && Number.isFinite(c.clutch) && Number.isFinite(c.handbrake)) return c;
  const f = (v: number) => (Number.isFinite(v) ? v : 0);
  return { throttle: f(c.throttle), brake: f(c.brake), steer: f(c.steer), clutch: f(c.clutch), shift: c.shift, handbrake: f(c.handbrake) };
}

/** Full `Controls` from the inputs given, with the clutch up, no shift and no handbrake. */
export function controls(c: Partial<Controls>): Controls {
  return { ...NO_CONTROLS, ...c };
}

export type WheelTyre = TyreDef & PreparedTyre;

export interface Wheel {
  readonly front: boolean;
  readonly driven: boolean;
  /** Top of the suspension in car local space. */
  readonly mount: Vec3;
  readonly tyre: WheelTyre;
  /** Distance from the mount down to the wheel centre (m). */
  suspensionLength: number;
  /** The wheel's steering angle (rad), positive = right. */
  steer: number;
  contact: boolean;
  surface: SurfaceTag | null;
  /** Vertical load on the tyre (N). */
  load: number;
  /** Angular velocity (rad/s); positive rolls forward. */
  omega: number;
  /** Relaxed slip ratio κ and slip angle α (rad): what the tyre's forces come from. */
  slipRatio: number;
  slipAngle: number;
  /** Tyre forces averaged over the step (N): along the wheel's heading and to its right. */
  longForce: number;
  latForce: number;
  /** The most force the tyre could make right now, in any direction (N). */
  gripLimit: number;
  /** Drive and brake torque on the wheel, averaged over the step (N·m). */
  driveTorque: number;
  brakeTorque: number;
  /** ABS: the share of the foot brake it lets through (1 = all of it). */
  absFactor: number;
  /** Brakes are holding the wheel still while the car moves. */
  locked: boolean;
  /** How worn the tyre is: 0 new, 1 worn out. */
  wear: number;
  /** Accumulated rolling angle, for drawing (rad). */
  spin: number;
}

/** Per-wheel working state that the presentation doesn't need. */
interface WheelWork {
  spin: SpinBody;
  /** Relaxed tan(slip angle). */
  tanSlip: number;
  /** Contact patch velocity along and across the wheel this step (m/s). */
  vLong: number;
  vLat: number;
  grip: number;
  rollingDrag: number;
  /** Contact point and tyre frame on the contact plane, in the world. */
  point: Vec3;
  fwd: Vec3;
  right: Vec3;
  fxSum: number;
  fySum: number;
  driveSum: number;
  brakeSum: number;
  /** This step's foot brake and handbrake torque on the wheel (N·m), before ABS. */
  footBrake: number;
  handbrake: number;
}

/** Where to put the car: a point on the road surface and the car's orientation there. */
export interface Pose {
  position: Vec3;
  rotation: Quat;
}

const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 });
/** Wheel indices of each axle, left then right. */
const AXLES = [
  [0, 1],
  [2, 3],
] as const;

export class Car {
  readonly body: RAPIER.RigidBody;
  /** The chassis box: what other cars and the barriers hit. */
  readonly collider: RAPIER.Collider;
  readonly wheels: Wheel[];
  /** Steering rack: the wheel angle at the middle of the front axle (rad), positive = right. */
  steerAngle = 0;
  readonly drivetrain: Drivetrain;
  /** Which driver aids are on. */
  aids: AidSettings = { abs: true, tc: true };
  /** ABS is easing a brake, or TC the throttle, this step (for the dashboard lights). */
  absActive = false;
  tcActive = false;

  private readonly world: RAPIER.World;
  private readonly driveOut: DriveOut = { left: 0, right: 0 };
  private readonly driveRear: DriveOut = { left: 0, right: 0 };
  /** Indices of the driven wheels (0, 1 front; 2, 3 rear). */
  private readonly drivenWheels: readonly number[];
  private readonly tags: Map<number, SurfaceTag>;
  private readonly work: WheelWork[];
  // Scratch, so the per-step maths allocates nothing of its own.
  private readonly ray = new RAPIER.Ray(vec(), vec());
  private readonly treadToi = [0, 0, 0];
  private readonly mountPoint = vec();
  private readonly normal = vec();
  private readonly carRight = vec();
  /** The surface under the wheel being worked on (reused). */
  private readonly surface = { grip: 1, drag: 0 };
  /** How wet the track is (0–1, set by the simulation): every surface's grip follows it. */
  wetness = 0;
  /** Tyre wear rate (times the normal; 0 for none). */
  wearRate = 0;
  /** Fuel aboard (kg): none unless a race fuels the car. */
  fuel = 0;
  /** The fuel the body's mass was last set for (kg). */
  private massFuel = 0;
  private readonly boxInertia: Vec3;
  private readonly carUp = vec();
  private readonly carForward = vec();
  private readonly heading = vec();
  private readonly force = vec();
  private readonly aeroPoint = vec();
  private readonly tyreForce: TyreForce = { fx: 0, fy: 0 };

  constructor(
    physics: Physics,
    pose: Pose,
    readonly def: CarDef = KESTREL,
  ) {
    this.world = physics.world;
    this.tags = physics.tags;
    const h = def.halfExtents;

    // Box inertia of the chassis' own mass, about the centre of mass.
    const m = def.mass;
    const w = 2 * h.x;
    const ht = 2 * h.y;
    const l = 2 * h.z;
    const inertia = { x: (m / 12) * (ht * ht + l * l), y: (m / 12) * (w * w + l * l), z: (m / 12) * (w * w + ht * ht) };
    this.boxInertia = inertia;

    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(m, def.centreOfMass, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z)
        .setDensity(0)
        .setFriction(0.3)
        .setRestitution(0.1)
        .setCollisionGroups(CAR_GROUPS)
        // Hard knocks (barriers, other cars) are reported for sparks and sound.
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(TUNING.contacts.minForce),
      this.body,
    );
    this.tags.set(this.collider.handle, 'car');

    this.drivetrain = new Drivetrain(def);

    const front = prepareTyre(def.tyres.front);
    const rear = prepareTyre(def.tyres.rear);
    this.wheels = [];
    this.work = [];
    const layout = def.drivetrain.layout;
    this.drivenWheels = layout === 'rwd' ? [2, 3] : layout === 'fwd' ? [0, 1] : [0, 1, 2, 3];
    for (const isFront of [true, false]) {
      for (const side of [-1, 1]) {
        const tyre = isFront ? front : rear;
        this.wheels.push({
          front: isFront,
          driven: layout === 'awd' || isFront === (layout === 'fwd'),
          mount: wheelMount(def, isFront, side),
          tyre,
          suspensionLength: (isFront ? def.suspension.front : def.suspension.rear).restLength,
          steer: 0,
          contact: false,
          surface: null,
          load: 0,
          omega: 0,
          slipRatio: 0,
          slipAngle: 0,
          longForce: 0,
          latForce: 0,
          gripLimit: 0,
          driveTorque: 0,
          brakeTorque: 0,
          absFactor: 1,
          locked: false,
          spin: 0,
          wear: 0,
        });
        this.work.push({
          spin: { omega: 0, inertia: tyre.inertia, torque: 0, friction: 0 },
          tanSlip: 0,
          vLong: 0,
          vLat: 0,
          grip: 0,
          rollingDrag: 0,
          point: vec(),
          fwd: vec(),
          right: vec(),
          fxSum: 0,
          fySum: 0,
          driveSum: 0,
          brakeSum: 0,
          footBrake: 0,
          handbrake: 0,
        });
      }
    }
    this.reset(pose);
  }

  /** Put the car at `pose`, at rest, with the wheels just touching the ground. */
  /** Fill the car with `kg` of fuel (its mass and balance follow). */
  setFuel(kg: number): void {
    this.fuel = Math.max(0, kg);
    this.applyMass();
  }

  /** Fresh tyres all round (a pit stop). */
  changeTyres(): void {
    for (const w of this.wheels) w.wear = 0;
  }

  /** The body's mass, centre of mass and inertia with the fuel aboard. */
  private applyMass(): void {
    const { def } = this;
    const m = def.mass + this.fuel;
    const c = def.centreOfMass;
    const com = { x: c.x, y: c.y, z: (def.mass * c.z + this.fuel * def.fuel.tankZ) / m };
    const k = m / def.mass;
    const i = this.boxInertia;
    this.body.setAdditionalMassProperties(m, com, { x: i.x * k, y: i.y * k, z: i.z * k }, { x: 0, y: 0, z: 0, w: 1 }, true);
    this.massFuel = this.fuel;
  }

  reset(pose: Pose): void {
    const body = restingPose(this.def, pose);
    this.body.setTranslation(body.position, true);
    this.body.setRotation(body.rotation, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    for (const w of this.wheels) w.steer = 0;
    this.drivetrain.reset();
    this.wheels.forEach((w, i) => {
      w.suspensionLength = (w.front ? this.def.suspension.front : this.def.suspension.rear).restLength;
      w.omega = w.slipRatio = w.slipAngle = 0;
      w.locked = false;
      w.absFactor = 1;
      this.work[i].spin.omega = 0;
      this.work[i].tanSlip = 0;
    });
  }

  /** Write the car's current pose into `out`. */
  capturePose(out: CarPose): void {
    const p = this.body.translation();
    const q = this.body.rotation();
    out.position.x = p.x;
    out.position.y = p.y;
    out.position.z = p.z;
    out.rotation.x = q.x;
    out.rotation.y = q.y;
    out.rotation.z = q.z;
    out.rotation.w = q.w;
    this.wheels.forEach((w, i) => {
      const o = out.wheels[i];
      o.suspensionLength = w.suspensionLength;
      o.steer = w.steer;
      o.spin = w.spin;
    });
  }

  get position(): Vec3 {
    return this.body.translation();
  }

  get rotation(): Quat {
    return this.body.rotation();
  }

  /** Unit vector the car points along, in the world. */
  get forward(): Vec3 {
    basis(this.rotation, this.carRight, this.carUp, this.carForward);
    return { ...this.carForward };
  }

  /**
   * Body slip angle β (rad): how far the car's direction of travel is from where it
   * points, positive when it travels to the right of its nose (a slide to the left, or
   * oversteer in a left turn). 0 when barely moving.
   */
  get bodySlipAngle(): number {
    basis(this.rotation, this.carRight, this.carUp, this.carForward);
    const v = this.body.linvel();
    const along = dot(v, this.carForward);
    const across = dot(v, this.carRight);
    return Math.hypot(along, across) < 0.5 ? 0 : Math.atan2(across, along);
  }

  /** In reverse gear. */
  get reversing(): boolean {
    return this.drivetrain.gearbox.gear === REVERSE;
  }

  /** Signed forward speed (m/s); negative when rolling backwards. */
  get speed(): number {
    const f = this.forward;
    const v = this.body.linvel();
    return v.x * f.x + v.y * f.y + v.z * f.z;
  }

  /** Compute and apply this step's suspension, tyre and drag forces. Call before `world.step()`. */
  update(input: Controls, dt: number): void {
    // A bad input (NaN from a buggy driver) must not poison the car's state for good.
    const controls = finiteControls(input);
    const body = this.body;
    body.resetForces(false);
    body.resetTorques(false);

    const right = this.carRight;
    const up = this.carUp;
    const fwd = this.carForward;
    basis(body.rotation(), right, up, fwd);
    const pos = body.translation();
    const linvel = body.linvel();
    const speed = dot(linvel, fwd);

    // The rack moves towards the steering position at its own pace; Ackermann splits the angle.
    const St = this.def.steering;
    this.steerAngle = rackStep(this.steerAngle, clamp(controls.steer, -1, 1) * St.lock, St.rate, dt);
    for (const w of this.wheels) {
      w.steer = w.front ? wheelSteerAngle(this.steerAngle, w.mount.x, 2 * this.def.wheelbaseHalf, St.ackermann) : 0;
    }
    const drivetrain = this.drivetrain;
    drivetrain.tractionControl = this.aids.tc;
    const wk = this.work;
    drivetrain.update(controls, drivetrain.outputOmega(wk[0].spin.omega, wk[1].spin.omega, wk[2].spin.omega, wk[3].spin.omega), speed, dt);
    // Fuel: burned with the engine's output; the car lightens as it goes.
    if (this.fuel > 0) {
      const output = Math.max(0, engineTorque(this.def.engine, drivetrain.rpm, drivetrain.throttle)) * drivetrain.engineOmega * dt;
      this.fuel = Math.max(0, this.fuel - fuelBurned(output, this.def.fuel.burn));
      if (Math.abs(this.fuel - this.massFuel) >= TUNING.fuel.massStep || this.fuel === 0) this.applyMass();
    }
    const pedalBrake = drivetrain.brakePedal;

    // 1. Suspension, contact frames and contact patch velocities.
    const B = this.def.brakes;
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      const work = this.work[i];
      const S = wheel.front ? this.def.suspension.front : this.def.suspension.rear;
      const radius = wheel.tyre.radius;
      const m = wheel.mount;
      const ox = pos.x + right.x * m.x + up.x * m.y - fwd.x * m.z;
      const oy = pos.y + right.y * m.x + up.y * m.y - fwd.y * m.z;
      const oz = pos.z + right.z * m.x + up.z * m.y - fwd.z * m.z;
      const o = this.mountPoint;
      o.x = ox;
      o.y = oy;
      o.z = oz;
      // Three rays down across the tread (its edges and middle, along the steered axle), the
      // highest hit taken: the tyre meets a kerb with its width, not a single thin ray. Rays,
      // not a swept cylinder: a shape-cast's tolerance put a 1 mm ripple at every mesh edge.
      const sinS = Math.sin(wheel.steer);
      const cosS = Math.cos(wheel.steer);
      const axleX = right.x * cosS - fwd.x * sinS;
      const axleY = right.y * cosS - fwd.y * sinS;
      const axleZ = right.z * cosS - fwd.z * sinS;
      const ray = this.ray;
      ray.dir.x = -up.x;
      ray.dir.y = -up.y;
      ray.dir.z = -up.z;
      let hit: RAPIER.RayColliderIntersection | null = null;
      let hitToi = Infinity;
      const tois = this.treadToi;
      for (let r = 0; r < TREAD.length; r++) {
        const a = TREAD[r] * wheel.tyre.width * 0.5;
        ray.origin.x = ox + axleX * a;
        ray.origin.y = oy + axleY * a;
        ray.origin.z = oz + axleZ * a;
        const h = this.world.castRayAndGetNormal(ray, S.restLength + radius, true, undefined, WHEEL_QUERY_GROUPS, undefined, body);
        tois[r] = h ? h.timeOfImpact : Infinity;
        // Prefer the middle ray on a tie, so a flat road gives the middle of the tread.
        if (h && h.timeOfImpact < hitToi - (r === 1 ? -TREAD_TIE : 0)) {
          hitToi = Math.min(hitToi, h.timeOfImpact);
          hit = h;
        }
      }
      // The contact is the middle of the rays that touch within TREAD_TIE of the highest:
      // the whole tread on a flat road, only the raised part on a kerb. (Taking just the
      // highest flipped between rays on rounding noise and shook the car.)
      let across = 0;
      let touching = 0;
      for (let r = 0; r < TREAD.length; r++) {
        if (tois[r] > hitToi + TREAD_TIE) continue;
        across += TREAD[r];
        touching++;
      }
      if (hit) {
        const a = (across / touching) * wheel.tyre.width * 0.5;
        const p = work.point;
        p.x = ox + axleX * a - up.x * hitToi;
        p.y = oy + axleY * a - up.y * hitToi;
        p.z = oz + axleZ * a - up.z * hitToi;
      }

      const share = wheel.front ? B.frontBias : 1 - B.frontBias;
      work.spin.friction = 0;
      work.footBrake = (pedalBrake * B.maxTorque * share) / 2;
      work.handbrake = wheel.front ? 0 : clamp(controls.handbrake, 0, 1) * B.handbrakeTorque;

      if (!hit) {
        wheel.contact = false;
        wheel.surface = null;
        wheel.load = wheel.gripLimit = 0;
        wheel.suspensionLength = S.restLength;
        work.grip = work.rollingDrag = work.vLong = work.vLat = 0;
        continue;
      }

      // Suspension: spring, bump / rebound damping and the bump stop.
      const length = Math.max(0, hitToi - radius);
      const mountVel = body.velocityAtPoint(o);
      const compressionRate = -dot(mountVel, up);
      const damping = compressionRate > 0 ? S.bump : S.rebound;
      const bumpStop = length < S.bumpStop.length ? S.bumpStop.stiffness * (S.bumpStop.length - length) : 0;
      const load = Math.max(0, S.stiffness * (S.restLength - length) + damping * compressionRate + bumpStop);
      wheel.contact = true;
      wheel.surface = this.tags.get(hit.collider.handle) ?? 'asphalt';
      wheel.suspensionLength = length;
      wheel.load = load;

      const p = work.point;
      // The ground's normal, kept within MAX_NORMAL_TILT of the car's up: the face of a kerb
      // bumps the tyre up without turning its force sideways.
      const n = this.normal;
      n.x = hit.normal.x;
      n.y = hit.normal.y;
      n.z = hit.normal.z;
      limitTilt(n, up);

      // Tyre frame on the contact plane. Steered wheels turn about the car's up axis (positive = right).
      const h = this.heading;
      const sin = Math.sin(wheel.steer);
      const cos = Math.cos(wheel.steer);
      h.x = fwd.x * cos + right.x * sin;
      h.y = fwd.y * cos + right.y * sin;
      h.z = fwd.z * cos + right.z * sin;
      const hn = dot(h, n);
      const tf = work.fwd;
      tf.x = h.x - n.x * hn;
      tf.y = h.y - n.y * hn;
      tf.z = h.z - n.z * hn;
      normalise(tf);
      const tr = work.right;
      // right = fwd × normal
      tr.x = tf.y * n.z - tf.z * n.y;
      tr.y = tf.z * n.x - tf.x * n.z;
      tr.z = tf.x * n.y - tf.y * n.x;
      normalise(tr);
      const v = body.velocityAtPoint(p);
      work.vLong = dot(v, tf);
      work.vLat = dot(v, tr);

    }

    // Anti-roll bars: each axle's bar pushes its more compressed wheel's side up and the
    // other down, in proportion to the difference in travel. Only with both wheels down.
    for (const [l, r] of AXLES) {
      const left = this.wheels[l];
      const right = this.wheels[r];
      if (!left.contact || !right.contact) continue;
      const S = left.front ? this.def.suspension.front : this.def.suspension.rear;
      const bar = S.antiRoll * (right.suspensionLength - left.suspensionLength);
      left.load = Math.max(0, left.load + bar);
      right.load = Math.max(0, right.load - bar);
    }

    // Apply the suspension forces; the tyres' grip follows from the loads.
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      const work = this.work[i];
      if (!wheel.contact) continue;
      const load = wheel.load;
      this.force.x = up.x * load;
      this.force.y = up.y * load;
      this.force.z = up.z * load;
      body.addForceAtPoint(this.force, work.point, false);
      const surface = surfaceGrip(wheel.surface, this.wetness, speed, this.surface);
      // A worn tyre has less grip, whatever it's on.
      surface.grip *= wearGrip(wheel.wear);
      work.grip = surface.grip;
      work.rollingDrag = (wheel.tyre.rollingResistance + surface.drag) * load * wheel.tyre.radius;
      wheel.gripLimit = gripLimit(wheel.tyre, load, surface.grip);
    }

    // Downforce (negative lift) on the body at each axle, from the airspeed along the car.
    const lift = this.def.aero.lift;
    const q = 0.5 * AIR_DENSITY * speed * speed;
    for (const [z, area] of [
      [-this.def.wheelbaseHalf, lift.front],
      [this.def.wheelbaseHalf, lift.rear],
    ]) {
      if (area === 0) continue;
      const f = this.force;
      f.x = up.x * q * area;
      f.y = up.y * q * area;
      f.z = up.z * q * area;
      const p = this.aeroPoint;
      p.x = pos.x + up.x * this.def.mountHeight - fwd.x * z;
      p.y = pos.y + up.y * this.def.mountHeight - fwd.y * z;
      p.z = pos.z + up.z * this.def.mountHeight - fwd.z * z;
      body.addForceAtPoint(f, p, false);
    }

    // 2. Substeps: tyre forces, wheel spin, slip relaxation.
    const I = TUNING.tyreIntegration;
    const substeps = I.substeps;
    const h = dt / substeps;
    for (const work of this.work) work.fxSum = work.fySum = work.driveSum = work.brakeSum = 0;
    const aids = this.def.aids;
    this.absActive = this.tcActive = false;
    for (let s = 0; s < substeps; s++) {
      // Tyre forces from the relaxed slip, and the torques they put on the wheels.
      for (let i = 0; i < 4; i++) {
        const wheel = this.wheels[i];
        const work = this.work[i];
        const r = wheel.tyre.radius;
        let fx = 0;
        let fy = 0;
        if (wheel.contact) {
          tyreForces(wheel.tyre, wheel.slipRatio, Math.atan(work.tanSlip), wheel.load, work.grip, this.tyreForce);
          fx = this.tyreForce.fx;
          fy = this.tyreForce.fy;
          // Low-speed damping of the slip velocity, fading out with speed.
          const fade = Math.max(0, 1 - Math.abs(work.vLong) / I.lowSpeedFade);
          if (fade > 0) {
            const c = I.lowSpeedDamping * wheel.load * fade;
            fx += c * (work.spin.omega * r - work.vLong);
            fy -= c * work.vLat;
          }
          const total = Math.hypot(fx, fy);
          if (total > wheel.gripLimit) {
            const k = wheel.gripLimit / total;
            fx *= k;
            fy *= k;
          }
        }
        work.spin.torque = -fx * r;
        // ABS eases the foot brake on a wheel that slips too much; the handbrake bypasses it.
        if (this.aids.abs && work.footBrake > 0 && wheel.contact) {
          wheel.absFactor = absStep(aids.abs, wheel.absFactor, wheel.slipRatio, wheel.tyre.peakSlipRatio, work.vLong, h);
          if (wheel.absFactor < 1) this.absActive = true;
        } else wheel.absFactor = 1;
        const brake = work.footBrake * wheel.absFactor + work.handbrake;
        work.brakeSum += brake;
        work.spin.friction = brake + work.rollingDrag;
        work.fxSum += fx;
        work.fySum += fy;
      }

      // Traction control eases the throttle while a driven wheel spins past its target slip.
      if (this.aids.tc) {
        const driven = this.drivenWheels;
        // Drive slip, signed with the direction of travel so reversing counts too.
        let slip = 0;
        let slipSpeed = 0;
        for (let k = 0; k < driven.length; k++) {
          const i = driven[k];
          const sign = this.work[i].vLong < 0 ? -1 : 1;
          const w = this.wheels[i];
          if (w.slipRatio * sign > slip) {
            slip = w.slipRatio * sign;
            slipSpeed = (this.work[i].spin.omega * w.tyre.radius - this.work[i].vLong) * sign;
          }
        }
        drivetrain.tcFactor = tcStep(aids.tc, drivetrain.tcFactor, slip, slipSpeed, this.wheels[driven[0]].tyre.peakSlipRatio, h);
        if (drivetrain.tcFactor < 1) this.tcActive = true;
      } else drivetrain.tcFactor = 1;

      // Wheel spin: the driven wheels with the engine through the drivetrain, the others free.
      const w = this.work;
      const layout = this.def.drivetrain.layout;
      if (layout === 'awd') {
        drivetrain.substepAwd(h, w[0].spin, w[1].spin, w[2].spin, w[3].spin, this.driveOut, this.driveRear);
        w[0].driveSum += this.driveOut.left;
        w[1].driveSum += this.driveOut.right;
        w[2].driveSum += this.driveRear.left;
        w[3].driveSum += this.driveRear.right;
      } else {
        const d = layout === 'fwd' ? 0 : 2;
        const f = 2 - d;
        spinFree(w[f].spin, h);
        spinFree(w[f + 1].spin, h);
        drivetrain.substep(h, w[d].spin, w[d + 1].spin, this.driveOut);
        w[d].driveSum += this.driveOut.left;
        w[d + 1].driveSum += this.driveOut.right;
      }

      // Relax the slip towards its new value (implicit in the |v| term, so it's stable at any speed).
      for (let i = 0; i < 4; i++) {
        const wheel = this.wheels[i];
        const work = this.work[i];
        const tyre = wheel.tyre;
        if (!wheel.contact) {
          wheel.slipRatio = work.tanSlip = 0;
          continue;
        }
        const lim = I.slipLimit;
        const vAbs = Math.abs(work.vLong);
        const ax = h / tyre.relaxationLong;
        wheel.slipRatio = clamp((wheel.slipRatio + ax * (work.spin.omega * tyre.radius - work.vLong)) / (1 + ax * vAbs), -lim, lim);
        const ay = h / tyre.relaxationLat;
        work.tanSlip = clamp((work.tanSlip + ay * work.vLat) / (1 + ay * vAbs), -lim, lim);
      }
    }

    // 3. Apply the average tyre forces.
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      const work = this.work[i];
      wheel.omega = work.spin.omega;
      wheel.spin += wheel.omega * dt;
      wheel.slipAngle = Math.atan(work.tanSlip);
      wheel.longForce = work.fxSum / substeps;
      wheel.latForce = work.fySum / substeps;
      wheel.driveTorque = work.driveSum / substeps;
      wheel.brakeTorque = work.brakeSum / substeps;
      // Locked: braked and turning at under LOCKED_SLIP of the road speed under it.
      wheel.locked = wheel.contact && wheel.brakeTorque > 0 && Math.abs(work.vLong) > 0.5 && Math.abs(wheel.omega * wheel.tyre.radius) < LOCKED_SLIP * Math.abs(work.vLong);
      if (!wheel.contact) continue;
      // Wear: the energy the contact patch dissipated this step.
      if (this.wearRate > 0) {
        const power = patchPower(wheel.longForce, wheel.latForce, wheel.omega * wheel.tyre.radius - work.vLong, work.vLat);
        wheel.wear = Math.min(1, wheel.wear + (this.wearRate * power * dt) / wheel.tyre.life);
      }
      const f = this.force;
      f.x = work.fwd.x * wheel.longForce + work.right.x * wheel.latForce;
      f.y = work.fwd.y * wheel.longForce + work.right.y * wheel.latForce;
      f.z = work.fwd.z * wheel.longForce + work.right.z * wheel.latForce;
      body.addForceAtPoint(f, work.point, false);
    }

    // Aerodynamic drag at the centre of mass.
    const vel = body.linvel();
    const k = -0.5 * AIR_DENSITY * this.def.aero.dragArea * Math.hypot(vel.x, vel.y, vel.z);
    this.force.x = vel.x * k;
    this.force.y = vel.y * k;
    this.force.z = vel.z * k;
    body.addForce(this.force, false);
  }
}

/** A braked wheel turning at under this fraction of the road speed counts as locked. */
const LOCKED_SLIP = 0.05;

/** Where the wheel's contact rays sit across the tread, as fractions of half its width. */
const TREAD = [-0.9, 0, 0.9];
/** Rays touching within this of the highest one count as touching too (m). */
const TREAD_TIE = 0.003;

/** How far the ground normal under a tyre may tilt from the car's up (rad). */
const MAX_NORMAL_TILT = Math.PI / 4;
const COS_TILT = Math.cos(MAX_NORMAL_TILT);
const SIN_TILT = Math.sin(MAX_NORMAL_TILT);

/** Tilt `n` (unit) back towards `up` (unit) so the angle between them is at most MAX_NORMAL_TILT. */
function limitTilt(n: Vec3, up: Vec3): void {
  const along = dot(n, up);
  if (along >= COS_TILT) return;
  // The sideways part of n, rescaled so n sits exactly on the cone's edge.
  let sx = n.x - up.x * along;
  let sy = n.y - up.y * along;
  let sz = n.z - up.z * along;
  const l = Math.hypot(sx, sy, sz);
  if (l < 1e-9) {
    n.x = up.x;
    n.y = up.y;
    n.z = up.z;
    return;
  }
  sx /= l;
  sy /= l;
  sz /= l;
  n.x = up.x * COS_TILT + sx * SIN_TILT;
  n.y = up.y * COS_TILT + sy * SIN_TILT;
  n.z = up.z * COS_TILT + sz * SIN_TILT;
}

/** The car's right, up and forward (-Z) axes in the world, from its rotation. */
function basis(q: Quat, right: Vec3, up: Vec3, forward: Vec3): void {
  const { x, y, z, w } = q;
  right.x = 1 - 2 * (y * y + z * z);
  right.y = 2 * (x * y + w * z);
  right.z = 2 * (x * z - w * y);
  up.x = 2 * (x * y - w * z);
  up.y = 1 - 2 * (x * x + z * z);
  up.z = 2 * (y * z + w * x);
  forward.x = -2 * (x * z + w * y);
  forward.y = -2 * (y * z - w * x);
  forward.z = -(1 - 2 * (x * x + y * y));
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function normalise(v: Vec3): void {
  const l = Math.hypot(v.x, v.y, v.z);
  if (l > 1e-9) {
    v.x /= l;
    v.y /= l;
    v.z /= l;
  }
}

/** Where wheel's suspension is mounted on the body (car frame): front or rear, left (−1) or right (1). */
function wheelMount(def: CarDef, front: boolean, side: number): Vec3 {
  return { x: side * def.trackHalf, y: def.mountHeight, z: front ? -def.wheelbaseHalf : def.wheelbaseHalf };
}

/** The four wheels' mounts in the order a `Car` keeps them (front left, front right, rear left, rear right). */
export function wheelMounts(def: CarDef): Vec3[] {
  return [wheelMount(def, true, -1), wheelMount(def, true, 1), wheelMount(def, false, -1), wheelMount(def, false, 1)];
}

/** The body's pose for a car at rest at `pose` on the road: raised along its up until the wheels just touch. */
export function restingPose(def: CarDef, pose: Pose): Pose {
  const height = -def.mountHeight + def.suspension.front.restLength + def.tyres.front.radius - 0.03;
  const right = { x: 0, y: 0, z: 0 };
  const up = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: 0 };
  basis(pose.rotation, right, up, forward);
  const p = pose.position;
  return { position: { x: p.x + up.x * height, y: p.y + up.y * height, z: p.z + up.z * height }, rotation: { ...pose.rotation } };
}

/** Where to put the car at a track sample: on the road, facing the driving direction, pitched and banked with it. */
export function poseOnTrack(p: TrackSample): Pose {
  // Car local axes: +X right (the road's −left), +Y up, +Z back (−tangent).
  const rotation = quatFromBasis({ x: -p.lx, y: -p.ly, z: -p.lz }, { x: p.ux, y: p.uy, z: p.uz }, { x: -p.tx, y: -p.ty, z: -p.tz });
  return { position: { x: p.x, y: p.y, z: p.z }, rotation };
}
