// The light of the time of day: the sky, the sun (the moon at night), the sky's fill light and
// the fog, blended from the day's (as the weather left them) through dusk to night by the light
// level (`track/timeOfDay.ts`); and as it gets dark, the floodlights' baked light coming up
// (`nightLight.ts`). Reads the light level; never touches the simulation.

import * as THREE from 'three';
import { TUNING } from '../config';
import { lightsOn } from '../track/timeOfDay';
import { nightUniforms } from './nightLight';
import type { Stage } from './scene';

interface Look {
  sky: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  elevation: number;
  fill: number;
  fogNear: number;
  fogFar: number;
}

export class Lighting {
  /** Where the sun sits relative to what it lights (pass to `followSun`). */
  readonly sunOffset = new THREE.Vector3();
  private readonly day: Look;
  private readonly dusk: Look;
  private readonly night: Look;
  private readonly azimuth: THREE.Vector2;
  private readonly distance: number;
  private level = -1;
  /** Floodlight at the camera's car, for the extra fill light on cars under the lights. */
  private floodAtCar = 0;
  private fillNow = 0;

  /** Built after the weather has set the day's sky, fog and sun. */
  constructor(
    private readonly stage: Stage,
    dayOffset: THREE.Vector3,
  ) {
    const L = TUNING.night.look;
    const fog = stage.scene.fog as THREE.Fog;
    const sky = (stage.scene.background as THREE.Color).clone();
    this.day = { sky, sun: stage.sun.color.clone(), sunIntensity: stage.sun.intensity, elevation: Math.atan2(dayOffset.y, Math.hypot(dayOffset.x, dayOffset.z)), fill: stage.fill.intensity, fogNear: fog.near, fogFar: fog.far };
    // The weather's greying carries into dusk and night: a wet night is darker still.
    const grey = (c: number) => new THREE.Color(c).lerp(sky, 0.25 * (1 - sky.getHSL({ h: 0, s: 0, l: 0 }).s));
    const at = (k: 'dusk' | 'night'): Look => ({
      sky: grey(L.sky[k]),
      sun: new THREE.Color(L.sun[k].colour),
      sunIntensity: this.day.sunIntensity * L.sun[k].share,
      elevation: L.sun[k].elevation,
      fill: this.day.fill * L.fill[k],
      fogNear: Math.min(this.day.fogNear, L.fog[k][0]),
      fogFar: Math.min(this.day.fogFar, L.fog[k][1]),
    });
    this.dusk = at('dusk');
    this.night = at('night');
    this.azimuth = new THREE.Vector2(dayOffset.x, dayOffset.z).normalize();
    this.distance = dayOffset.length();
    this.set(1);
  }

  /** The light level now (1 day … 0 night). Cheap when it hasn't changed. */
  set(level: number): void {
    if (Math.abs(level - this.level) < 1e-4) return;
    this.level = level;
    const D = TUNING.night.levels.dusk;
    const [a, b, f] = level >= D ? [this.dusk, this.day, (level - D) / (1 - D)] : [this.night, this.dusk, level / D];
    const mix = (x: number, y: number) => x + (y - x) * f;
    const { scene, sun } = this.stage;
    const sky = a.sky.clone().lerp(b.sky, f);
    scene.background = sky;
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(sky);
    fog.near = mix(a.fogNear, b.fogNear);
    fog.far = mix(a.fogFar, b.fogFar);
    sun.color.copy(a.sun).lerp(b.sun, f);
    sun.intensity = mix(a.sunIntensity, b.sunIntensity);
    this.fillNow = mix(a.fill, b.fill);
    const e = mix(a.elevation, b.elevation);
    this.sunOffset.set(this.azimuth.x * Math.cos(e), Math.sin(e), this.azimuth.y * Math.cos(e)).multiplyScalar(this.distance);
    // The floodlights come up as the light goes, from nothing at the switch-on level to full at night.
    const on = lightsOn(level) ? 1 - level / TUNING.night.lightsOn : 0;
    nightUniforms.uFlood.value = TUNING.night.look.flood * on;
    nightUniforms.uUnlit.value = 1 - (1 - TUNING.night.look.unlit) * (1 - level);
    this.applyFill();
  }

  /** The floodlight where the camera's car is: cars under the lights get a little more fill. */
  setFloodAtCar(light: number): void {
    this.floodAtCar = light;
    this.applyFill();
  }

  private applyFill(): void {
    const night = 1 - this.level;
    this.stage.fill.intensity = this.fillNow + TUNING.night.look.carFill * this.floodAtCar * night * (nightUniforms.uFlood.value > 0 ? 1 : 0);
  }
}
