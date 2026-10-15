// Keyboard steering: turns digital left / right keys into a steering position for
// `Controls.steer`. It is a driver, not part of the car: it reads the car's state but
// can't change its grip, and it runs once per physics step so a recording of the
// `Controls` it produced replays exactly.
//
// Always: the position eases towards the keys' target and back to centre.
// With the assist on:
//   - Speed-sensitive lock: full keys give the wheel angle the front tyres can use at
//     this speed, not full lock, so a tap at 200 km/h doesn't throw the car sideways.
//   - Counter-steer help: when the car slides, the target leans against the slide, so
//     letting go of the keys lets it straighten. Keys held the other way still win.

import { TUNING } from '../config';
import { GRAVITY } from '../constants';
import { clamp, damp } from '../math';
import type { Car } from '../vehicle/car';

/**
 * Fraction of full lock (0–1) the front tyres can use at `speed` (m/s): the geometric
 * angle for a turn at `limitG`, plus a margin over their peak slip angle.
 */
export function usableLock(car: Car, speed: number): number {
  const K = TUNING.keyboardSteering;
  const wheelbase = 2 * car.def.wheelbaseHalf;
  const geometric = Math.atan2(wheelbase * K.limitG * Math.abs(GRAVITY), speed * speed);
  const angle = geometric + K.slipMargin * car.wheels[0].tyre.peakSlipAngle;
  return Math.min(1, angle / car.def.steering.lock);
}

/** The steering position (fraction of full lock) that leans against the car's slide. */
export function counterSteer(car: Car): number {
  const K = TUNING.keyboardSteering;
  if (car.speed < K.counterSteerSpeed) return 0;
  const beta = car.bodySlipAngle;
  const excess = Math.sign(beta) * Math.max(0, Math.abs(beta) - K.slipDeadband);
  return clamp((K.counterSteer * excess) / car.def.steering.lock, -K.counterSteerMax, K.counterSteerMax);
}

export class KeyboardSteering {
  /** The steering position (−1..1 of full lock) this produces. */
  position = 0;
  assist = true;

  reset(): void {
    this.position = 0;
  }

  /** `keys`: −1 (left), 0 or +1 (right). Returns the new steering position. */
  update(keys: number, car: Car, dt: number): number {
    const K = TUNING.keyboardSteering;
    let target = keys;
    if (this.assist) {
      target = keys * usableLock(car, Math.abs(car.speed));
      const help = counterSteer(car);
      if (keys === 0) target = help;
      else if (Math.sign(keys) === Math.sign(help)) target = keys * Math.max(Math.abs(target), Math.abs(help));
    }
    const returning = Math.abs(target) < Math.abs(this.position);
    this.position += (target - this.position) * damp(returning ? K.release : K.attack, dt);
    return this.position;
  }
}
