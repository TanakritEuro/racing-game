// Car models from Kenney's Car Kit (CC0, see ASSETS.md), fitted to the simulated cars. Each
// model's wheels go onto the physics wheel mounts and its body is scaled so the arches sit over
// them; the paint is repainted per car. Presentation only: the simulation never sees a model.
//
// The kit's models face +Z with +X on their left; ours face −Z with +X on the right, so every
// model is turned half round about Y. They share one palette texture of flat and graded colour
// cells; a body's paint is the saturated cell most of its vertices use.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarDef } from '../vehicle/carDef';

/** Which kit model draws which car. */
const MODEL_FOR: Record<string, string> = {
  Wren: 'hatchback-sports',
  Kestrel: 'sedan',
  Harrier: 'sedan-sports',
};

/** Wheel node names in the order of `Car.wheels`: front left, front right, rear left, rear right. */
const WHEEL_NODES = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];

/** The palette: 512 px square, cells 64 px wide (a flat and a graded column) and 128 px tall. */
const CELL_W = 64;
const CELL_H = 128;

export interface CarModel {
  /** The body, in car space (origin at the chassis box's centre, −Z forward). */
  body: THREE.Object3D;
  /** Each wheel centred on its own origin, axle along X, sized to the car's tyres. */
  wheels: THREE.Object3D[];
  /** Where the bumper and hood cameras go on this model (car space): ahead of its nose, and just above its bonnet. */
  cameras: { bumper: THREE.Vector3; hood: THREE.Vector3 };
}

/** The hood camera sits this far above the bonnet (m), this far back from the front axle (share of half the wheelbase). */
const HOOD_LIFT = 0.22;
const HOOD_BACK = 0.45;
/** The bumper camera sits this far ahead of the nose (m). */
const BUMPER_AHEAD = 0.1;

const loader = new GLTFLoader();
const files = new Map<string, Promise<GLTF>>();

/** The model for `def` painted `colour`, or null if it has none or fails to load (the placeholder stays). */
export async function loadCarModel(def: CarDef, colour: number): Promise<CarModel | null> {
  const name = MODEL_FOR[def.name];
  if (!name) return null;
  try {
    let file = files.get(name);
    if (!file) files.set(name, (file = loader.loadAsync(`${import.meta.env.BASE_URL}models/cars/${name}.glb`)));
    return fit((await file).scene, def, colour);
  } catch (e) {
    console.warn(`Car model ${name} didn't load; drawing the placeholder.`, e);
    return null;
  }
}

function fit(scene: THREE.Object3D, def: CarDef, colour: number): CarModel {
  const source = scene.clone(true);
  source.rotation.y = Math.PI;
  source.updateMatrixWorld(true);
  const wheelNodes = WHEEL_NODES.map((n) => source.getObjectByName(n));
  const bodyParts = source.children.filter((c) => !WHEEL_NODES.includes(c.name));
  if (wheelNodes.some((w) => !w) || bodyParts.length === 0) throw new Error('unexpected model layout');

  // Wheel centres in the turned model, and the body's extent.
  const centre = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const hubs = wheelNodes.map((w) => centre(w!));
  const box = new THREE.Box3();
  for (const p of bodyParts) box.expandByObject(p);
  const size = box.getSize(new THREE.Vector3());

  // Arches over our wheels along the car; the collision box's width across it; height in proportion.
  const modelBase = Math.abs(hubs[0].z - hubs[2].z);
  const sz = (2 * def.wheelbaseHalf) / modelBase;
  const sx = (2 * def.halfExtents.x) / size.x;
  const sy = (sx + sz) / 2;
  // The model's wheel centre height, which lands on our wheels' centre at rest.
  const hubY = hubs[0].y;
  const hubZ = (hubs[0].z + hubs[2].z) / 2;
  const S = def.suspension.front;
  const sag = (def.mass * 9.81 * 0.5) / 2 / S.stiffness;
  const restHub = def.mountHeight - (S.restLength - sag);

  const body = new THREE.Group();
  const shell = new THREE.Group();
  for (const p of bodyParts) shell.add(p);
  shell.scale.set(sx, sy, sz);
  shell.position.set(0, restHub - hubY * sy, -hubZ * sz);
  shell.rotation.y = Math.PI;
  body.add(shell);

  // Wheels: each centred, then scaled to the tyre's radius and width.
  const wheels = wheelNodes.map((w, i) => {
    const tyre = i < 2 ? def.tyres.front : def.tyres.rear;
    const node = w!;
    const own = new THREE.Box3().setFromObject(node);
    const wheelSize = own.getSize(new THREE.Vector3());
    const holder = new THREE.Group();
    const turned = new THREE.Group();
    turned.rotation.y = Math.PI;
    turned.add(node);
    // The node's own offset in the model goes; its mesh is centred on the holder instead.
    node.position.set(0, 0, 0);
    turned.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(turned).getCenter(new THREE.Vector3());
    turned.position.sub(c);
    holder.add(turned);
    holder.scale.set(tyre.width / wheelSize.x, (2 * tyre.radius) / wheelSize.y, (2 * tyre.radius) / wheelSize.z);
    return holder;
  });

  paint(body, colour);

  // Cameras: above the bonnet (a ray down onto the body), and just ahead of the nose.
  body.updateMatrixWorld(true);
  const shellBox = new THREE.Box3().setFromObject(body);
  const hoodZ = -def.wheelbaseHalf * (1 - HOOD_BACK);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, shellBox.max.y + 1, hoodZ), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(body, true)[0];
  const hood = new THREE.Vector3(0, (hit ? hit.point.y : shellBox.max.y) + HOOD_LIFT, hoodZ);
  const bumper = new THREE.Vector3(0, def.cameras.bumper.y, shellBox.min.z - BUMPER_AHEAD);

  for (const o of [body, ...wheels]) {
    o.traverse((m) => {
      if (m instanceof THREE.Mesh) m.castShadow = true;
    });
  }
  return { body, wheels, cameras: { bumper, hood } };
}

const painted = new Map<string, THREE.Texture>();

/** Repaint the body's paint cell in `colour`, keeping the palette's shading. */
function paint(body: THREE.Object3D, colour: number): void {
  const meshes: THREE.Mesh[] = [];
  body.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  const material = meshes[0]?.material as THREE.MeshStandardMaterial | undefined;
  const image = material?.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!material || !image) return;
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const ctx = source.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, source.width, source.height);

  // The cell most of the body's vertices use, among the colourful ones.
  const counts = new Map<number, number>();
  for (const m of meshes) {
    const uv = m.geometry.getAttribute('uv');
    if (!uv) continue;
    for (let i = 0; i < uv.count; i++) {
      const cx = Math.min(source.width / CELL_W - 1, Math.floor((uv.getX(i) * source.width) / CELL_W));
      const cy = Math.min(source.height / CELL_H - 1, Math.floor((uv.getY(i) * source.height) / CELL_H));
      const key = cy * 64 + cx;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const cellMean = (key: number) => {
    const x0 = (key % 64) * CELL_W;
    const y0 = Math.floor(key / 64) * CELL_H;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = y0; y < y0 + CELL_H; y += 4) {
      for (let x = x0; x < x0 + CELL_W; x += 4) {
        const o = (y * source.width + x) * 4;
        r += pixels.data[o];
        g += pixels.data[o + 1];
        b += pixels.data[o + 2];
      }
    }
    const n = (CELL_W / 4) * (CELL_H / 4);
    return new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
  };
  let paintCell = -1;
  let most = 0;
  for (const [key, count] of counts) {
    const hsl = cellMean(key).getHSL({ h: 0, s: 0, l: 0 });
    if (hsl.s > 0.35 && hsl.l > 0.2 && count > most) {
      most = count;
      paintCell = key;
    }
  }
  if (paintCell < 0) return;

  const cacheKey = `${paintCell}/${colour}`;
  let texture = painted.get(cacheKey);
  if (!texture) {
    const mean = cellMean(paintCell);
    const meanLum = Math.max(0.05, (mean.r + mean.g + mean.b) / 3);
    // The colour as stored in the (sRGB) texture: straight from the hex, not THREE.Color's linear values.
    const target = { r: ((colour >> 16) & 255) / 255, g: ((colour >> 8) & 255) / 255, b: (colour & 255) / 255 };
    const x0 = (paintCell % 64) * CELL_W;
    const y0 = Math.floor(paintCell / 64) * CELL_H;
    const out = ctx.getImageData(0, 0, source.width, source.height);
    for (let y = y0; y < y0 + CELL_H; y++) {
      for (let x = x0; x < x0 + CELL_W; x++) {
        const o = (y * source.width + x) * 4;
        // Keep the cell's light and shade, in the new colour.
        const shade = (out.data[o] + out.data[o + 1] + out.data[o + 2]) / 3 / 255 / meanLum;
        out.data[o] = Math.min(255, target.r * shade * 255);
        out.data[o + 1] = Math.min(255, target.g * shade * 255);
        out.data[o + 2] = Math.min(255, target.b * shade * 255);
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d')!.putImageData(out, 0, 0);
    texture = new THREE.CanvasTexture(canvas);
    const original = material.map!;
    texture.flipY = original.flipY;
    texture.colorSpace = original.colorSpace;
    texture.magFilter = original.magFilter;
    texture.minFilter = original.minFilter;
    painted.set(cacheKey, texture);
  }
  const repainted = material.clone();
  repainted.map = texture;
  for (const m of meshes) m.material = repainted;
}
