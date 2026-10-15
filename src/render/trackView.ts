import * as THREE from 'three';
import { BARRIER_HEIGHT, BARRIER_THICKNESS } from '../physics';
import { barriers, ribbon, type Ribbon } from '../track/geometry';
import type { Track } from '../track/track';

/** Painted layers sit on the road with a polygon offset, so they never z-fight with it. */
const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };

/** Road, edge lines, start line, grass and barriers, built from the same data as the colliders. */
export function createTrackView(track: Track): THREE.Group {
  const group = new THREE.Group();
  const half = track.def.width / 2;

  group.add(createGrass());

  const road = mesh(ribbon(track, -half, half, 0.0), new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92 }), 6);
  road.receiveShadow = true;
  group.add(road);

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, ...decal });
  // ribbon(inner, outer) faces up only when inner < outer, hence min/max for the right-hand side.
  const strip = (a: number, b: number, y: number) => ribbon(track, Math.min(a, b), Math.max(a, b), y);
  for (const side of [1, -1]) {
    group.add(mesh(strip(side * (half - 0.45), side * (half - 0.3), 0.01), lineMat));
  }
  // Kerb-coloured strip just outside each edge.
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.8, ...decal });
  for (const side of [1, -1]) {
    const kerb = mesh(strip(side * half, side * (half + 0.8), 0.005), kerbMat, 2);
    kerb.receiveShadow = true;
    group.add(kerb);
  }

  group.add(createStartLine(track));
  group.add(createBarriers(track));
  return group;
}

/** A BufferGeometry from a ribbon, with UVs: u across, v along the track every `repeat` metres. */
function mesh(r: Ribbon, material: THREE.Material, repeat = 1): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  const uv = new Float32Array(r.distance.length * 2);
  for (let i = 0; i < r.distance.length; i++) {
    uv[i * 2] = i % 2;
    uv[i * 2 + 1] = r.distance[i] / repeat;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(r.indices, 1));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

function createGrass(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4f8a3a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const g = 110 + Math.floor(Math.random() * 50);
    ctx.fillStyle = `rgb(${g - 50},${g},${g - 70})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(400, 400);
  tex.anisotropy = 8;
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  // Drawn a little below its collider (top at -5 mm) so it never shows through the road.
  grass.position.y = -0.04;
  grass.receiveShadow = true;
  return grass;
}

function asphaltTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a4c50';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const g = 55 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgb(${g},${g},${g + 3})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function kerbTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d42a24';
  ctx.fillRect(0, 0, 4, 1);
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 1, 4, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createStartLine(track: Track): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < 24; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const p = track.samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(track.def.width, 1), new THREE.MeshBasicMaterial({ map: tex }));
  line.rotation.x = -Math.PI / 2;
  // Lay the plane's width along the track normal.
  line.rotation.z = Math.atan2(p.nz, p.nx);
  line.position.set(p.x, 0.012, p.z);
  (line.material as THREE.Material).setValues(decal);
  return line;
}

/** Tyre-wall style barriers, instanced, alternating red and white. */
function createBarriers(track: Track): THREE.InstancedMesh {
  const segs = barriers(track);
  const geo = new THREE.BoxGeometry(BARRIER_THICKNESS, BARRIER_HEIGHT, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const inst = new THREE.InstancedMesh(geo, mat, segs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const red = new THREE.Color(0xc0302a);
  const white = new THREE.Color(0xeeeeee);
  segs.forEach((b, i) => {
    q.setFromAxisAngle(up, b.yaw);
    m.compose(new THREE.Vector3(b.x, BARRIER_HEIGHT / 2, b.z), q, new THREE.Vector3(1, 1, b.length));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, i % 2 ? red : white);
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  return inst;
}
