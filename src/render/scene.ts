import * as THREE from 'three';
import type { Quality } from './quality';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The sun. Its shadow box follows the car (call `followSun`). */
  sun: THREE.DirectionalLight;
  /** The sky's fill light. */
  fill: THREE.HemisphereLight;
}

/** Where the sun sits by day, relative to what it lights. */
export const SUN_OFFSET = new THREE.Vector3(-40, 70, 30);

export function createStage(canvas: HTMLCanvasElement, q: Quality): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const skyColour = new THREE.Color(0x9cc6ee);
  scene.background = skyColour;
  scene.fog = new THREE.Fog(skyColour, 250, 900);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 2000);

  const fill = new THREE.HemisphereLight(0xe4f0ff, 0x46603a, 1.1);
  scene.add(fill);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  const s = sun.shadow.camera;
  s.left = -30;
  s.right = 30;
  s.top = 30;
  s.bottom = -30;
  s.near = 1;
  s.far = 200;
  scene.add(sun, sun.target);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun, fill };
}

/** Keep the sun's (small, sharp) shadow box centred on `focus`, the sun `offset` from it (lower at dusk). */
export function followSun(sun: THREE.DirectionalLight, focus: THREE.Vector3, offset: THREE.Vector3 = SUN_OFFSET): void {
  sun.target.position.copy(focus);
  sun.position.copy(focus).add(offset);
}
