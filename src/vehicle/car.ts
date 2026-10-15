// The car: a Rapier rigid body for the chassis, with four raycast wheels whose suspension
// and tyre forces are computed here each physics step and applied to the chassis.
//
// Pure simulation: no Three.js, DOM or audio. The presentation reads `wheels`, `steerAngle`
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
// The rear wheels are driven through the drivetrain (`drivetrain.ts`): engine, clutch,
// gearbox and differential.

import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config';
import { AIR_DENSITY } from '../constants';
import { clamp, damp, type Quat, type Vec3 } from '../math';
import type { Physics, SurfaceTag } from '../physics';
import type { CarDef, TyreDef } from './carDef';
import { KESTREL } from './cars';
import { Drivetrain, type DriveOut } from './drivetrain';
import { REVERSE } from './gearbox';
import { spinFree, type SpinBody } from './spin';
import { gripLimit, prepareTyre, tyreForces, type PreparedTyre, type TyreForce } from './tyre';

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
}

export const NO_CONTROLS: Readonly<Controls> = { throttle: 0, brake: 0, steer: 0, clutch: 0, shift: 0 };

/** Full `Controls` from the inputs given, with the clutch up and no shift. */
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
  /** Brakes are holding the wheel still while the car moves. */
  locked: boolean;
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
}

export interface Pose {
  position: Vec3;
  /** Heading: rotation about +Y (rad). 0 faces -Z. */
  yaw: number;
}

const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 });
/** Wheel indices of each axle, left then right. */
const AXLES = [
  [0, 1],
  [2, 3],
] as const;

export class Car {
  readonly body: RAPIER.RigidBody;
  readonly wheels: Wheel[];
  /** Current front wheel angle (rad), positive = right. */
  steerAngle = 0;
  readonly drivetrain: Drivetrain;

  private readonly world: RAPIER.World;
  private readonly driveOut: DriveOut = { left: 0, right: 0 };
  private readonly tags: Map<number, SurfaceTag>;
  private readonly work: WheelWork[];
  // Scratch, so the per-step maths allocates nothing of its own.
  private readonly ray: RAPIER.Ray;
  private readonly carRight = vec();
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

    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(m, def.centreOfMass, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setDensity(0).setFriction(0.3).setRestitution(0.1),
      this.body,
    );
    this.tags.set(collider.handle, 'car');
    this.ray = new RAPIER.Ray(vec(), vec());
    this.drivetrain = new Drivetrain(def);

    const front = prepareTyre(def.tyres.front);
    const rear = prepareTyre(def.tyres.rear);
    this.wheels = [];
    this.work = [];
    for (const isFront of [true, false]) {
      for (const side of [-1, 1]) {
        const tyre = isFront ? front : rear;
        this.wheels.push({
          front: isFront,
          driven: !isFront, // rear-wheel drive
          mount: { x: side * def.trackHalf, y: def.mountHeight, z: isFront ? -def.wheelbaseHalf : def.wheelbaseHalf },
          tyre,
          suspensionLength: (isFront ? def.suspension.front : def.suspension.rear).restLength,
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
          locked: false,
          spin: 0,
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
        });
      }
    }
    this.reset(pose);
  }

  /** Put the car at `pose`, at rest, with the wheels just touching the ground. */
  reset(pose: Pose): void {
    const S = this.def.suspension.front;
    const y = pose.position.y - this.def.mountHeight + S.restLength + this.def.tyres.front.radius - 0.03;
    this.body.setTranslation({ x: pose.position.x, y, z: pose.position.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(pose.yaw / 2), z: 0, w: Math.cos(pose.yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.drivetrain.reset();
    this.wheels.forEach((w, i) => {
      w.suspensionLength = (w.front ? this.def.suspension.front : this.def.suspension.rear).restLength;
      w.omega = w.slipRatio = w.slipAngle = 0;
      w.locked = false;
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
      o.steer = w.front ? this.steerAngle : 0;
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
  update(controls: Controls, dt: number): void {
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

    this.updateSteering(controls.steer, Math.abs(speed), dt);
    const drivetrain = this.drivetrain;
    drivetrain.update(controls, (this.work[2].spin.omega + this.work[3].spin.omega) / 2, speed, dt);
    const pedalBrake = drivetrain.brakePedal;

    // 1. Suspension, contact frames and contact patch velocities.
    const B = this.def.brakes;
    const sinSteer = Math.sin(this.steerAngle);
    const cosSteer = Math.cos(this.steerAngle);
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      const work = this.work[i];
      const S = wheel.front ? this.def.suspension.front : this.def.suspension.rear;
      const radius = wheel.tyre.radius;
      const m = wheel.mount;
      const ox = pos.x + right.x * m.x + up.x * m.y - fwd.x * m.z;
      const oy = pos.y + right.y * m.x + up.y * m.y - fwd.y * m.z;
      const oz = pos.z + right.z * m.x + up.z * m.y - fwd.z * m.z;
      const o = this.ray.origin;
      o.x = ox;
      o.y = oy;
      o.z = oz;
      const d = this.ray.dir;
      d.x = -up.x;
      d.y = -up.y;
      d.z = -up.z;
      const hit = this.world.castRayAndGetNormal(this.ray, S.restLength + radius, true, undefined, undefined, undefined, body);

      const share = wheel.front ? B.frontBias : 1 - B.frontBias;
      work.spin.friction = 0;
      wheel.brakeTorque = (pedalBrake * B.maxTorque * share) / 2;

      if (!hit) {
        wheel.contact = false;
        wheel.surface = null;
        wheel.load = wheel.gripLimit = 0;
        wheel.suspensionLength = S.restLength;
        work.grip = work.rollingDrag = work.vLong = work.vLat = 0;
        continue;
      }

      // Suspension: spring, bump / rebound damping and the bump stop.
      const toi = hit.timeOfImpact;
      const length = Math.max(0, toi - radius);
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
      p.x = ox - up.x * toi;
      p.y = oy - up.y * toi;
      p.z = oz - up.z * toi;

      // Tyre frame on the contact plane. Steered wheels turn about the car's up axis (positive = right).
      const h = this.heading;
      const sin = wheel.front ? sinSteer : 0;
      const cos = wheel.front ? cosSteer : 1;
      h.x = fwd.x * cos + right.x * sin;
      h.y = fwd.y * cos + right.y * sin;
      h.z = fwd.z * cos + right.z * sin;
      const n = hit.normal;
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
      const surface = wheel.surface === 'grass' ? TUNING.surfaces.grass : TUNING.surfaces.asphalt;
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
    for (const work of this.work) work.fxSum = work.fySum = work.driveSum = 0;
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
        work.spin.friction = wheel.brakeTorque + work.rollingDrag;
        work.fxSum += fx;
        work.fySum += fy;
      }

      // Wheel spin: the driven wheels with the engine through the drivetrain, the others free.
      spinFree(this.work[0].spin, h);
      spinFree(this.work[1].spin, h);
      drivetrain.substep(h, this.work[2].spin, this.work[3].spin, this.driveOut);
      this.work[2].driveSum += this.driveOut.left;
      this.work[3].driveSum += this.driveOut.right;

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
      wheel.locked = wheel.contact && wheel.brakeTorque > 0 && wheel.omega === 0 && Math.abs(work.vLong) > 0.5;
      if (!wheel.contact) continue;
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

  private updateSteering(input: number, speed: number, dt: number): void {
    const St = TUNING.steering;
    const lock = this.def.steeringLock / (1 + speed / St.halfLockSpeed);
    const target = clamp(input, -1, 1) * lock;
    const returning = Math.abs(target) < Math.abs(this.steerAngle);
    this.steerAngle += (target - this.steerAngle) * damp(returning ? St.returnRate : St.rate, dt);
  }

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

/** What the presentation draws: the chassis transform and each wheel's travel, steer and roll. */
export interface CarPose {
  position: Vec3;
  rotation: Quat;
  wheels: { suspensionLength: number; steer: number; spin: number }[];
}

export function createPose(): CarPose {
  return {
    position: vec(),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    wheels: [0, 1, 2, 3].map(() => ({ suspensionLength: 0, steer: 0, spin: 0 })),
  };
}

export function copyPose(from: CarPose, to: CarPose): void {
  Object.assign(to.position, from.position);
  Object.assign(to.rotation, from.rotation);
  from.wheels.forEach((w, i) => Object.assign(to.wheels[i], w));
}

/** Where to put the car at track sample `index`, facing the driving direction. */
export function poseOnTrack(sample: { x: number; z: number; tx: number; tz: number }): Pose {
  // Yaw θ turns local -Z into (-sin θ, 0, -cos θ); match it to the tangent.
  return { position: { x: sample.x, y: 0, z: sample.z }, yaw: Math.atan2(-sample.tx, -sample.tz) };
}
