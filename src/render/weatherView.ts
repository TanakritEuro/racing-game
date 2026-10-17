// The weather on screen: an overcast sky with the fog drawn in and the sun dimmed, and in the
// wet, rain. The rain is a few thousand streaks in one draw call; each has a fixed place in
// the world, wrapped round the camera in a box that moves with it (so the rain doesn't swim
// as you drive) and falling on the shader's clock. Reads nothing from the simulation but the
// wetness it is built with.

import * as THREE from 'three';
import { TUNING } from '../config';
import type { Stage } from './scene';

const RAIN_VERTEX = `
attribute float aEnd;
uniform float uTime;
uniform vec3 uCentre;
uniform float uRadius;
uniform float uHeight;
uniform float uFall;
uniform float uLength;
uniform vec2 uWind;
varying float vFade;
void main() {
  // Wrap each drop's fixed place into the box round the camera, and let it fall.
  float span = 2.0 * uRadius;
  vec3 local = vec3(
    mod(position.x - uCentre.x + uRadius, span) - uRadius,
    mod(position.y - uTime * uFall, uHeight),
    mod(position.z - uCentre.z + uRadius, span) - uRadius);
  vec3 world = vec3(uCentre.x, uCentre.y - 0.5 * uHeight, uCentre.z) + local;
  // A streak: the top end trails back up along the way the drop came.
  world += aEnd * uLength * normalize(vec3(-uWind.x, uFall, -uWind.y));
  vFade = 1.0 - smoothstep(0.4 * uRadius, uRadius, length(local.xz));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const RAIN_FRAGMENT = `
uniform vec3 uColour;
uniform float uOpacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColour, uOpacity * vFade);
}`;

export class WeatherView {
  private readonly rain: THREE.LineSegments | null = null;
  private readonly material: THREE.ShaderMaterial | null = null;
  private time = 0;

  /** `wet`: how wet (0 dry … 1 wet): the sky greys and the light dims with it; rain falls when fully wet. */
  /** `share`: how much of the rain to draw (Graphics Low draws less). */
  constructor(stage: Stage, wet: number, share = 1) {
    const W = TUNING.effects.weather;
    const sky = new THREE.Color(W.sky.dry).lerp(new THREE.Color(W.sky.wet), wet);
    stage.scene.background = sky;
    const fog = stage.scene.fog as THREE.Fog;
    fog.color = sky;
    fog.near = W.fog.dry[0] + (W.fog.wet[0] - W.fog.dry[0]) * wet;
    fog.far = W.fog.dry[1] + (W.fog.wet[1] - W.fog.dry[1]) * wet;
    stage.sun.intensity *= 1 - (1 - W.sun) * wet;
    if (wet < 1) return;

    const R = { ...W.rain, drops: Math.ceil(W.rain.drops * share) };
    const positions = new Float32Array(R.drops * 6);
    const ends = new Float32Array(R.drops * 2);
    for (let i = 0; i < R.drops; i++) {
      // A fixed random place per drop (presentation only: the simulation never sees it).
      const x = (Math.random() * 2 - 1) * R.radius;
      const y = Math.random() * R.height;
      const z = (Math.random() * 2 - 1) * R.radius;
      positions.set([x, y, z, x, y, z], i * 6);
      ends.set([0, 1], i * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new THREE.Vector3() },
        uRadius: { value: R.radius },
        uHeight: { value: R.height },
        uFall: { value: R.fall },
        uLength: { value: R.length },
        uWind: { value: new THREE.Vector2(R.wind[0], R.wind[1]) },
        uColour: { value: new THREE.Color(R.colour) },
        uOpacity: { value: R.opacity },
      },
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(geometry, this.material);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 3;
    stage.scene.add(this.rain);
  }

  /** Each frame: the rain falls on by `dt` round the camera at `centre`. */
  update(dt: number, centre: THREE.Vector3): void {
    if (!this.material) return;
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uCentre.value.copy(centre);
  }

  /** Rain while a replay plays too; hidden only if asked. */
  set visible(on: boolean) {
    if (this.rain) this.rain.visible = on;
  }
}
