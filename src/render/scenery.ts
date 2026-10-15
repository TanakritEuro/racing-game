import * as THREE from 'three';
import type { Building, SceneryLayout } from '../track/scenery';

/** Low-poly scenery: instanced trees, grandstands and a pit building. Placeholder art until Milestone 6. */
export function createSceneryView(layout: SceneryLayout): THREE.Group {
  const group = new THREE.Group();
  if (layout.trees.length > 0) group.add(...createTrees(layout));
  for (const g of layout.grandstands) group.add(createGrandstand(g));
  if (layout.pits) group.add(createPits(layout.pits));
  return group;
}

/** Cone trees: one instanced mesh for trunks, one for foliage, sizes and shades varied. */
function createTrees(layout: SceneryLayout): THREE.InstancedMesh[] {
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  const crownGeo = new THREE.ConeGeometry(2.4, 7, 7);
  crownGeo.translate(0, 5.6, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 }), layout.trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), layout.trees.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const colour = new THREE.Color();
  layout.trees.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.shade * 6.28);
    m.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), q, new THREE.Vector3(t.scale, t.scale, t.scale));
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
    colour.setHSL(0.27 + t.shade * 0.08, 0.45, 0.2 + t.shade * 0.1);
    crowns.setColorAt(i, colour);
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return [trunks, crowns];
}

/** Place `object` (built with its length along local X, facing local −Z) at a building's spot. */
function place(object: THREE.Object3D, b: Building): THREE.Object3D {
  object.position.set(b.x, b.y, b.z);
  // Local −Z (the front) towards the track, local X along it.
  object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-b.fz, 0, b.fx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-b.fx, 0, -b.fz)));
  return object;
}

/** A grandstand: stepped tiers rising away from the track, a back wall and a roof, its long side facing the track. */
function createGrandstand(b: Building): THREE.Object3D {
  const g = new THREE.Group();
  const length = Math.max(20, b.length);
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.9 });
  const seats = new THREE.MeshStandardMaterial({ color: 0x2c5aa0, roughness: 0.7 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6, side: THREE.DoubleSide });
  const tiers = 6;
  for (let k = 0; k < tiers; k++) {
    // Each tier 1.2 m deep and 0.9 m higher, further from the track.
    const tier = new THREE.Mesh(new THREE.BoxGeometry(length, 0.9 * (k + 1), 1.2), k % 2 ? seats : concrete);
    tier.position.set(0, (0.9 * (k + 1)) / 2, k * 1.2);
    g.add(tier);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(length, 9, 0.4), concrete);
  back.position.set(0, 4.5, tiers * 1.2);
  g.add(back);
  const top = new THREE.Mesh(new THREE.BoxGeometry(length + 2, 0.25, tiers * 1.2 + 2), roof);
  top.position.set(0, 9, (tiers * 1.2) / 2 - 0.5);
  g.add(top);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return place(g, b);
}

/** The pit building: a long low block with garage doors facing the track and a roof terrace. */
function createPits(b: Building): THREE.Object3D {
  const g = new THREE.Group();
  const length = b.length;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d8dde2';
  ctx.fillRect(0, 0, 64, 32);
  ctx.fillStyle = '#39414a';
  ctx.fillRect(8, 10, 48, 22);
  ctx.fillStyle = '#4a7fb5';
  ctx.fillRect(0, 0, 64, 5);
  const doors = new THREE.CanvasTexture(canvas);
  doors.colorSpace = THREE.SRGBColorSpace;
  doors.wrapS = THREE.RepeatWrapping;
  doors.repeat.set(length / 8, 1);
  const wall = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.8 });
  const front = new THREE.MeshStandardMaterial({ map: doors, roughness: 0.7 });
  // Box faces: +X, −X, +Y, −Y, +Z, −Z; the garage doors on −Z, towards the track.
  const block = new THREE.Mesh(new THREE.BoxGeometry(length, 6, 14), [wall, wall, wall, wall, wall, front]);
  block.position.set(0, 3, 7);
  g.add(block);
  const terrace = new THREE.Mesh(new THREE.BoxGeometry(length, 3, 8), wall);
  terrace.position.set(0, 7.5, 9);
  g.add(terrace);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return place(g, b);
}
