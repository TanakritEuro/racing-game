// The game's sound, driven from the simulation each frame: your car's engine, tyres, kerbs and
// wind; the three nearest other cars' engines and tyres, panned and fading with distance; pops
// on gearshifts; thuds and scrapes from knocks. Reads the simulation; never writes to it.

import { slideAmount } from '../render/effects/skidMarks';
import type { Contact, Simulation } from '../sim';
import type { Controls } from '../vehicle/car';
import type { CarDef } from '../vehicle/carDef';
import { CarVoice } from './carVoice';
import { distanceGain, engineVoice, rainHiss, rumble, squeal, swish, wind } from './mix';
import { RainVoice } from './rainVoice';
import { wetness } from '../track/weather';
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

/** Another player's car (online): where it is drawn, and what its states say about its engine. */
export interface RemoteSound {
  x: number;
  z: number;
  def: CarDef;
  rpm: number;
  throttle: number;
  speed: number;
}

export class GameAudio {
  private own: CarVoice | null = null;
  private others: CarVoice[] = [];
  private rain: RainVoice | null = null;
  private lastGear = 0;

  constructor(private readonly sound: Sound) {}

  /** Build the voices once the sound is unlocked. */
  private ready(): boolean {
    const { ctx, master, noise } = this.sound;
    if (!ctx || !master || !noise) return false;
    if (!this.own) {
      this.own = new CarVoice(ctx, master, noise, true);
      this.others = Array.from({ length: VOICES }, () => new CarVoice(ctx, master, noise, false));
      this.rain = new RainVoice(ctx, master, noise);
    }
    return true;
  }

  /** Each frame: every voice from the cars as they are. `controls[k]` is car k's last controls; `remotes`: other players' cars. */
  update(sim: Simulation, controls: readonly Controls[], listener: Listener, remotes: readonly RemoteSound[] = []): void {
    if (!this.ready()) return;
    const car = sim.car;
    const c = controls[0];
    const speed = Math.abs(car.speed);
    const slide = Math.max(...car.wheels.map(slideAmount));
    const kerbs = car.wheels.filter((w) => w.contact && w.surface === 'kerb').length;
    const wet = wetness(sim.conditions);
    this.own!.update(engineVoice(car.def.engine, car.drivetrain.rpm, c?.throttle ?? 0), squeal(slide, speed, wet), 1, 0, rumble(kerbs, speed), wind(speed));
    this.rain!.update(rainHiss(wet), swish(car.wheels.some((w) => w.contact) ? wet : 0, speed));
    // A pop on each gearshift under power.
    const gear = car.drivetrain.gearbox.gear;
    if (gear !== this.lastGear && (c?.throttle ?? 0) > 0.3) this.sound.pop(1);
    this.lastGear = gear;

    // The nearest other cars: simulated here, or another player's (no tyre sound: its slip isn't sent).
    const sources = [
      ...sim.cars.slice(1).map((other, i) => ({
        x: other.position.x,
        z: other.position.z,
        def: other.def,
        rpm: other.drivetrain.rpm,
        throttle: controls[i + 1]?.throttle ?? 0.5,
        speed: Math.abs(other.speed),
        slide: Math.max(...other.wheels.map(slideAmount)),
      })),
      ...remotes.map((r) => ({ ...r, speed: Math.abs(r.speed), slide: 0 })),
    ];
    const near = sources
      .map((s) => ({ s, d: Math.hypot(s.x - listener.x, s.z - listener.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, VOICES);
    this.others.forEach((voice, v) => {
      const o = near[v];
      if (!o) {
        voice.silence();
        return;
      }
      const { s } = o;
      const pan = ((s.x - listener.x) * listener.rightX + (s.z - listener.z) * listener.rightZ) / Math.max(1, o.d);
      voice.update(engineVoice(s.def.engine, s.rpm, s.throttle), squeal(s.slide, s.speed, wet), OTHERS * distanceGain(o.d), pan);
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
    this.rain!.update({ gain: 0 }, { gain: 0, cutoff: 500 });
  }
}
