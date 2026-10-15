// The car: a Rapier rigid body for the chassis, with four raycast wheels whose suspension
// and tyre forces are computed here each physics step and applied to the chassis.
//
// Pure simulation: no Three.js, DOM or audio. The presentation reads `wheels`, `steerAngle`
// and the chassis transform after each step.
//
// PLACEHOLDER MODEL (Milestone 1 replaces it): wheels have no rotational dynamics of their
// own, drive force comes straight from a power curve, and lateral grip is linear in slip
// angle up to a friction circle. It is enough to drive and to oversteer under power, but
// it can't do wheelspin, lock-ups that matter, or a believable limit.

import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING } from '../config';
import { AIR_DENSITY } from '../constants';
import { add, clamp, cross, damp, dot, length, normalize, rotate, rotateAbout, scale, sub, type Quat, type Vec3 } from '../math';
import type { Physics, SurfaceTag } from '../physics';

/** One step's driver inputs. Keyboard, gamepad and AI drivers all produce these. */
export interface Controls {
  /** 0–1 */
  throttle: number;
  /** 0–1. Held at a standstill it engages reverse. */
  brake: number;
  /** -1 (full left) to +1 (full right). */
  steer: number;
}

export const NO_CONTROLS: Controls = { throttle: 0, brake: 0, steer: 0 };

export interface Wheel {
  readonly front: boolean;
  readonly driven: boolean;
  /** Top of the suspension in car local space. */
  readonly mount: Vec3;
  /** Distance from the mount down to the wheel centre (m). */
  suspensionLength: number;
  contact: boolean;
  surface: SurfaceTag | null;
  /** Vertical load on the tyre (N). */
  load: number;
  /** Slip angle (rad) and the forces the tyre made this step (N, along / across the wheel). */
  slipAngle: number;
  longForce: number;
  latForce: number;
  /** Accumulated rolling angle, for drawing (rad). */
  spin: number;
}

export interface Pose {
  position: Vec3;
  /** Heading: rotation about +Y (rad). 0 faces -Z. */
  yaw: number;
}

const UP_LOCAL: Vec3 = { x: 0, y: 1, z: 0 };
const FORWARD_LOCAL: Vec3 = { x: 0, y: 0, z: -1 };
/** Brake / rolling resistance force per m/s of wheel speed below the limit: stops cleanly without jitter. */
const LOW_SPEED_STIFFNESS = 15000;

export class Car {
  readonly body: RAPIER.RigidBody;
  readonly wheels: Wheel[];
  /** Current front wheel angle (rad), positive = right. */
  steerAngle = 0;
  /** True while the car is in reverse (brake held from a standstill). */
  reversing = false;

  private readonly world: RAPIER.World;
  private readonly tags: Map<number, SurfaceTag>;

  constructor(physics: Physics, pose: Pose) {
    this.world = physics.world;
    this.tags = physics.tags;
    const C = TUNING.car;
    const h = C.halfExtents;

    // Box inertia of the chassis' own mass; the centre of mass sits below the box centre.
    const m = C.mass;
    const w = 2 * h.x;
    const ht = 2 * h.y;
    const l = 2 * h.z;
    const inertia = { x: (m / 12) * (ht * ht + l * l), y: (m / 12) * (w * w + l * l), z: (m / 12) * (w * w + ht * ht) };

    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(m, { x: 0, y: C.comHeightOffset, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setDensity(0).setFriction(0.3).setRestitution(0.1),
      this.body,
    );
    this.tags.set(collider.handle, 'car');

    this.wheels = [];
    for (const front of [true, false]) {
      for (const side of [-1, 1]) {
        this.wheels.push({
          front,
          driven: !front, // rear-wheel drive
          mount: { x: side * C.trackHalf, y: C.mountHeight, z: front ? -C.wheelbaseHalf : C.wheelbaseHalf },
          suspensionLength: TUNING.suspension.restLength,
          contact: false,
          surface: null,
          load: 0,
          slipAngle: 0,
          longForce: 0,
          latForce: 0,
          spin: 0,
        });
      }
    }
    this.reset(pose);
  }

  /** Put the car at `pose`, at rest, with the wheels just touching the ground. */
  reset(pose: Pose): void {
    const S = TUNING.suspension;
    const y = pose.position.y - TUNING.car.mountHeight + S.restLength + TUNING.car.wheelRadius - 0.03;
    this.body.setTranslation({ x: pose.position.x, y, z: pose.position.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(pose.yaw / 2), z: 0, w: Math.cos(pose.yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.reversing = false;
    for (const w of this.wheels) w.suspensionLength = S.restLength;
  }

  get position(): Vec3 {
    return this.body.translation();
  }

  get rotation(): Quat {
    return this.body.rotation();
  }

  /** Unit vector the car points along, in the world. */
  get forward(): Vec3 {
    return rotate(this.rotation, FORWARD_LOCAL);
  }

  /** Signed forward speed (m/s); negative when rolling backwards. */
  get speed(): number {
    return dot(this.body.linvel(), this.forward);
  }

  /** Compute and apply this step's suspension, tyre and drag forces. Call before `world.step()`. */
  update(controls: Controls, dt: number): void {
    const body = this.body;
    body.resetForces(false);
    body.resetTorques(false);

    const q = this.rotation;
    const pos = body.translation();
    const up = rotate(q, UP_LOCAL);
    const down = scale(up, -1);
    const carForward = rotate(q, FORWARD_LOCAL);
    const speed = dot(body.linvel(), carForward);

    this.updateSteering(controls.steer, Math.abs(speed), dt);
    this.updateGear(controls, speed);
    const pedalDrive = this.reversing ? controls.brake : controls.throttle;
    const pedalBrake = this.reversing ? controls.throttle : controls.brake;

    // Total drive force, shared by the driven wheels: power-limited, capped at low speed.
    const E = TUNING.engine;
    const driveTotal = this.reversing
      ? -pedalDrive * E.reverseForce
      : pedalDrive * Math.min(E.maxDriveForce, E.power / Math.max(Math.abs(speed), 1));
    const drivenCount = this.wheels.filter((w) => w.driven).length;

    const S = TUNING.suspension;
    const T = TUNING.tyres;
    const B = TUNING.brakes;
    const radius = TUNING.car.wheelRadius;
    const reach = S.restLength + radius;

    for (const wheel of this.wheels) {
      const mount = add(pos, rotate(q, wheel.mount));
      const hit = this.world.castRayAndGetNormal(
        new RAPIER.Ray(mount, down),
        reach,
        true,
        undefined,
        undefined,
        undefined,
        body,
      );

      // Steered wheels turn about the car's up axis (positive angle = right = clockwise from above).
      const heading = wheel.front ? rotateAbout(carForward, up, -this.steerAngle) : carForward;
      wheel.spin += (dot(body.linvel(), heading) / radius) * dt;

      if (!hit) {
        wheel.contact = false;
        wheel.surface = null;
        wheel.load = wheel.longForce = wheel.latForce = wheel.slipAngle = 0;
        wheel.suspensionLength = S.restLength;
        continue;
      }

      const contact = add(mount, scale(down, hit.timeOfImpact));
      const normal = hit.normal;
      wheel.contact = true;
      wheel.surface = this.tags.get(hit.collider.handle) ?? 'asphalt';
      wheel.suspensionLength = Math.max(0, hit.timeOfImpact - radius);

      // Suspension: spring on compression, damper on the rate of compression.
      const compression = S.restLength - wheel.suspensionLength;
      const compressionRate = -dot(body.velocityAtPoint(mount), up);
      const load = Math.max(0, S.stiffness * compression + S.damping * compressionRate);
      wheel.load = load;
      body.addForceAtPoint(scale(up, load), contact, false);

      // Tyre frame on the contact plane.
      const fwd = normalize(sub(heading, scale(normal, dot(heading, normal))));
      const right = normalize(cross(fwd, normal));
      const v = body.velocityAtPoint(contact);
      const vLong = dot(v, fwd);
      const vLat = dot(v, right);

      const surface = wheel.surface === 'grass' ? TUNING.surfaces.grass : TUNING.surfaces.asphalt;
      const limit = surface.grip * load;

      // Longitudinal: drive, brakes, rolling resistance.
      let fx = wheel.driven ? driveTotal / drivenCount : 0;
      const brakeShare = wheel.front ? 2 * B.frontBias : 2 * (1 - B.frontBias);
      const brakeMax = pedalBrake * B.strength * limit * brakeShare;
      fx -= clamp(vLong * LOW_SPEED_STIFFNESS, -brakeMax, brakeMax);
      const rollMax = (TUNING.car.rollingResistance + surface.drag) * load;
      fx -= clamp(vLong * LOW_SPEED_STIFFNESS, -rollMax, rollMax);

      // Lateral: linear in slip angle (placeholder for a Pacejka curve).
      const slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), T.lowSpeedClamp));
      let fy = -T.corneringStiffness * slipAngle * load;

      // Friction circle: the tyre can't exceed its grip in any direction.
      const total = Math.hypot(fx, fy);
      if (total > limit && total > 0) {
        fx *= limit / total;
        fy *= limit / total;
      }
      wheel.slipAngle = slipAngle;
      wheel.longForce = fx;
      wheel.latForce = fy;
      body.addForceAtPoint(add(scale(fwd, fx), scale(right, fy)), contact, false);
    }

    // Aerodynamic drag at the centre of mass.
    const vel = body.linvel();
    const k = -0.5 * AIR_DENSITY * TUNING.car.dragArea * length(vel);
    body.addForce(scale(vel, k), false);
  }

  private updateSteering(input: number, speed: number, dt: number): void {
    const St = TUNING.steering;
    const lock = St.maxAngle / (1 + speed / St.halfLockSpeed);
    const target = clamp(input, -1, 1) * lock;
    const returning = Math.abs(target) < Math.abs(this.steerAngle);
    this.steerAngle += (target - this.steerAngle) * damp(returning ? St.returnRate : St.rate, dt);
  }

  private updateGear(controls: Controls, speed: number): void {
    const below = TUNING.engine.reverseBelow;
    if (!this.reversing && controls.brake > 0 && controls.throttle === 0 && speed < below) this.reversing = true;
    else if (this.reversing && controls.throttle > 0 && controls.brake === 0 && speed > -below) this.reversing = false;
  }
}

/** Where to put the car at track sample `index`, facing the driving direction. */
export function poseOnTrack(sample: { x: number; z: number; tx: number; tz: number }): Pose {
  // Yaw θ turns local -Z into (-sin θ, 0, -cos θ); match it to the tangent.
  return { position: { x: sample.x, y: 0, z: sample.z }, yaw: Math.atan2(-sample.tx, -sample.tz) };
}
