import * as THREE from 'three';
import { uprightAlong } from '../math';
import { BARRIER_HEIGHT, BARRIER_THICKNESS } from '../physics';
import { barriers, crossSection, KERB_STRIPE, kerbs, road, runoff, strip, sweep, type Offset, type Ribbon, type Sweep } from '../track/geometry';
import type { Terrain } from '../track/terrain';
import type { Track, TrackSample } from '../track/track';
import { puddleSweeps } from '../track/puddles';
import { boxOffset, laneSweep, pitLane, pitWall } from '../track/pitLane';
import { TUNING } from '../config';
import { createTerrainView } from './terrainView';

/** Painted layers sit on the road with a polygon offset, so they never z-fight with it. */
const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };

/**
 * Road, edge lines, run-off, start line, ground and barriers, built from the same data as the
 * colliders; `wet` (0–1) darkens and glosses the road and kerbs, and fully wet adds the puddles.
 */
export function createTrackView(track: Track, terrain: Terrain, wet = 0): THREE.Group {
  const W = TUNING.effects.weather;
  const group = new THREE.Group();
  const grass = grassTexture();

  group.add(createTerrainView(terrain, grass));

  const wetLook = (m: THREE.MeshStandardMaterial) => {
    m.roughness += (W.road.roughness - m.roughness) * wet;
    m.color.multiplyScalar(1 - (1 - W.road.darken) * wet);
    return m;
  };
  const surface = mesh(road(track), wetLook(new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92 })), 6);
  surface.receiveShadow = true;
  group.add(surface);
  const lane = pitLane(track);
  if (lane) {
    const pits = sweepMesh(laneSweep(track, lane), wetLook(new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92 })), 6);
    pits.receiveShadow = true;
    group.add(pits);
    // Each box painted on the lane.
    const P = TUNING.pits;
    const boxMat = new THREE.MeshBasicMaterial({ color: 0xf0c419, transparent: true, opacity: 0.55, ...decal });
    const n = track.samples.length;
    const half = Math.max(1, Math.round(2.5 / (track.length / n)));
    for (const b of lane.boxes) {
      const mid = boxOffset();
      group.add(
        sweepMesh(
          sweep(track, (b - half + n) % n, (b + half) % n, 1, (p) => {
            const a = p.halfWidth + mid - P.boxDepth / 2 + 0.3;
            const c = p.halfWidth + mid + P.boxDepth / 2 - 0.3;
            return lane.sign > 0
              ? [
                  [a, P.lift + 0.005],
                  [c, P.lift + 0.005],
                ]
              : [
                  [-c, P.lift + 0.005],
                  [-a, P.lift + 0.005],
                ];
          }),
          boxMat,
          4,
        ),
      );
    }
  }
  if (wet >= 1) {
    const P = W.puddle;
    const water = new THREE.MeshStandardMaterial({ color: P.colour, roughness: P.roughness, metalness: P.metalness, transparent: true, opacity: P.opacity, ...decal });
    for (const p of puddleSweeps(track)) {
      const m = sweepMesh(p, water, 4);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // A strip between two offsets on one side: +1 left, −1 right (mirrored so it still faces up).
  const side = (s: number, inner: (p: TrackSample) => number, outer: (p: TrackSample) => number, lift = 0): Ribbon =>
    s > 0
      ? strip(track, inner, outer, lift)
      : strip(
          track,
          (p) => -outer(p),
          (p) => -inner(p),
          lift,
        );

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, ...decal });
  for (const s of [1, -1]) group.add(mesh(side(s, (p) => p.halfWidth - 0.45, (p) => p.halfWidth - 0.3, 0.01), lineMat));

  // Kerbs: one paint stripe per KERB_STRIPE, red over the ridges.
  const kerbMat = wetLook(new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.8 }));
  for (const k of kerbs(track)) group.add(sweepMesh(k, kerbMat, 2 * KERB_STRIPE));
  const grassMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 1 });
  const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 });
  for (const r of runoff(track, 'grass')) group.add(sweepMesh(r, grassMat, 10));
  for (const r of runoff(track, 'gravel')) group.add(sweepMesh(r, gravelMat, 4));

  group.add(createStartLine(track));
  group.add(createBarriers(track));
  return group;
}

/** A mesh from a sweep, its texture repeating every `repeat` metres along. */
function sweepMesh(sw: Sweep, material: THREE.Material, repeat: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(sw.positions, 3));
  const uv = sw.uv.slice();
  for (let i = 1; i < uv.length; i += 2) uv[i] /= repeat;
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(sw.indices, 1));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  return m;
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

function grassTexture(): THREE.Texture {
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
  tex.anisotropy = 8;
  return tex;
}

function gravelTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#b9a98a';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2500; i++) {
    const g = 140 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgb(${g},${g - 12},${g - 35})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
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

/** Red over white along v, so with the canvas flipped red covers the first half of each tile, over the ridges. */
function kerbTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, 4, 1);
  ctx.fillStyle = '#d42a24';
  ctx.fillRect(0, 1, 4, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Chequered start line across the road at sample 0, laid on the road's surface. */
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
  // A quad 1 m long, the road's width across, in the sample's cross-section frame.
  const corner = (across: Offset, along: number) => {
    const c = crossSection(p, typeof across === 'number' ? across : across(p), 0.012);
    return [c.x + p.tx * along, c.y + p.ty * along, c.z + p.tz * along];
  };
  const hw = p.halfWidth;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...corner(hw, -0.5), ...corner(-hw, -0.5), ...corner(hw, 0.5), ...corner(-hw, 0.5)], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, ...decal }));
}

/** Tyre-wall style barriers, instanced, alternating red and white, following the ground. */
function createBarriers(track: Track): THREE.InstancedMesh {
  const lane = pitLane(track);
  const segs = [...barriers(track), ...(lane ? pitWall(track, lane) : [])];
  const geo = new THREE.BoxGeometry(BARRIER_THICKNESS, BARRIER_HEIGHT, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const inst = new THREE.InstancedMesh(geo, mat, segs.length);
  const m = new THREE.Matrix4();
  const red = new THREE.Color(0xc0302a);
  const white = new THREE.Color(0xeeeeee);
  segs.forEach((b, i) => {
    const r = uprightAlong(b.dir);
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    m.compose(new THREE.Vector3(b.centre.x, b.centre.y + BARRIER_HEIGHT / 2, b.centre.z), q, new THREE.Vector3(1, 1, b.length));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, i % 2 ? red : white);
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  return inst;
}
