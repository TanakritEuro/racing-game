// The game's sound, driven from the simulation each frame: your car's engine, tyres, kerbs and
// wind; the three nearest other cars' engines and tyres, panned and fading with distance; pops
// on gearshifts; thuds and scrapes from knocks. Reads the simulation; never writes to it.

import { slideAmount } from '../render/effects/skidMarks';
import type { Contact, Simulation } from '../sim';
import type { Controls } from '../vehicle/car';
import type { CarDef } from '../vehicle/carDef';
import { CarVoice } from './carVoice';
import { distanceGain, engineVoice, rumble, squeal, wind } from './mix';
import type { Sound } from './sound';

/** Other cars given their own voice. */
const VOICES = 3;
/** Other cars a little quieter than your own. */
const OTHERS = 0.8;

/** Where the listener is (the camera) and which way is right, on the ground. */
export interface Listener {
  x: number;
  y: number;
  z: number;
  rightX: number;
  rightZ: number;
}

export class GameAudio {
  private own: CarVoice | null = null;
  private others: CarVoice[] = [];
  private lastGear = 0;

  constructor(private readonly sound: Sound) {}

  /** Build the voices once the sound is unlocked. */
  private ready(): boolean {
    const { ctx, master, noise } = this.sound;
    if (!ctx || !master || !noise) return false;
    if (!this.own) {
      this.own = new CarVoice(ctx, master, noise, true);
      this.others = Array.from({ length: VOICES }, () => new CarVoice(ctx, master, noise, false));
    }
    return true;
  }

  /** Each frame: every voice from the cars as they are. `controls[k]` is car k's last controls. */
  update(sim: Simulation, controls: readonly Controls[], listener: Listener): void {
    if (!this.ready()) return;
    const car = sim.car;
    const c = controls[0];
    const speed = Math.abs(car.speed);
    const slide = Math.max(...car.wheels.map(slideAmount));
    const kerbs = car.wheels.filter((w) => w.contact && w.surface === 'kerb').length;
    this.own!.update(engineVoice(car.def.engine, car.drivetrain.rpm, c?.throttle ?? 0), squeal(slide, speed), 1, 0, rumble(kerbs, speed), wind(speed));
    // A pop on each gearshift under power.
    const gear = car.drivetrain.gearbox.gear;
    if (gear !== this.lastGear && (c?.throttle ?? 0) > 0.3) this.sound.pop(1);
    this.lastGear = gear;

    // The nearest other cars.
    const near = sim.cars
      .map((other, k) => ({ k, d: k === 0 ? Infinity : Math.hypot(other.position.x - listener.x, other.position.z - listener.z) }))
      .filter((o) => o.k !== 0)
      .sort((a, b) => a.d - b.d)
      .slice(0, VOICES);
    this.others.forEach((voice, v) => {
      const o = near[v];
      if (!o) {
        voice.silence();
        return;
      }
      const other = sim.cars[o.k];
      const p = other.position;
      const pan = ((p.x - listener.x) * listener.rightX + (p.z - listener.z) * listener.rightZ) / Math.max(1, o.d);
      const otherSlide = Math.max(...other.wheels.map(slideAmount));
      voice.update(
        engineVoice(other.def.engine, other.drivetrain.rpm, controls[o.k]?.throttle ?? 0.5),
        squeal(otherSlide, Math.abs(other.speed)),
        OTHERS * distanceGain(o.d),
        pan,
      );
    });
  }

  /** Knocks from the last step: louder for your own car, fading with distance for others. */
  knocks(contacts: readonly Contact[], listener: Listener): void {
    for (const c of contacts) {
      const d = c.car === 0 ? 0 : Math.hypot(c.x - listener.x, c.z - listener.z);
      // Two cars touching report it once each: sound it once, from the lower-numbered car.
      if (c.against === 'car' && c.car !== 0 && contacts.some((o) => o.against === 'car' && o.car < c.car && Math.abs(o.x - c.x) < 0.01)) continue;
      this.sound.knock(c.impulse, c.car === 0 ? 1 : OTHERS * distanceGain(d), c.against);
    }
  }

  /** A replay: your car's engine from the recording, everything else quiet. */
  replay(def: CarDef, rpm: number, throttle: number): void {
    if (!this.ready()) return;
    this.own!.update(engineVoice(def.engine, rpm, throttle), { gain: 0, pitch: 500 }, 1, 0, { gain: 0, frequency: 20 }, { gain: 0, cutoff: 400 });
    for (const v of this.others) v.silence();
  }
}
