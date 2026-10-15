// The player's driver: keyboard and gamepad together → `Controls`, once per physics step.
// Pedals take whichever device presses harder; the steering follows whichever device
// steered last (the stick positions the rack directly, the keys go through the assist).

import { KeyboardSteering } from '../drivers/steeringAssist';
import type { Car, Controls } from '../vehicle/car';
import { Gamepad, IDLE_PAD, type PadFrame } from './gamepad';
import { Keyboard } from './keyboard';

export class PlayerInput {
  readonly keyboard = new Keyboard();
  readonly gamepad = new Gamepad();
  readonly steering = new KeyboardSteering();
  private pad: PadFrame = IDLE_PAD;
  private padSteers = false;

  /** Once a frame: read the gamepad. Returns its camera and reset presses. */
  poll(): { camera: boolean; reset: boolean } {
    this.pad = this.gamepad.poll();
    return { camera: this.pad.camera, reset: this.pad.reset };
  }

  /** Once per physics step: this step's controls. */
  controls(car: Car, dt: number): Controls {
    const keys = this.keyboard.controls();
    const pad = this.pad;
    if (pad.steering) this.padSteers = true;
    else if (keys.steer !== 0) this.padSteers = false;
    let steer: number;
    if (this.padSteers) {
      steer = pad.steer;
      // Hand back to the keys from where the stick left the wheel.
      this.steering.position = steer;
    } else steer = this.steering.update(keys.steer, car, dt);
    const keyShift = this.keyboard.takeShift();
    return {
      throttle: Math.max(keys.throttle, pad.throttle),
      brake: Math.max(keys.brake, pad.brake),
      steer,
      clutch: 0,
      shift: keyShift !== 0 ? keyShift : this.gamepad.takeShift(),
      handbrake: Math.max(keys.handbrake, pad.handbrake),
    };
  }

  /** After the car is put back on the track: centre the steering. */
  reset(): void {
    this.steering.reset();
  }
}
