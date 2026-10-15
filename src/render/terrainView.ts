import * as THREE from 'three';
import type { Terrain } from '../track/terrain';

/** The ground mesh: the same heightfield the physics uses, textured with `map` every 10 m. */
export function createTerrainView(t: Terrain, map: THREE.Texture): THREE.Mesh {
  const { nx, nz, spacing } = t;
  const positions = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const k = iz + ix * nz;
      positions.set([t.x0 + ix * spacing, t.heights[k], t.z0 + iz * spacing], k * 3);
      uv.set([(ix * spacing) / 10, (iz * spacing) / 10], k * 2);
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let ix = 0; ix < nx - 1; ix++) {
    for (let iz = 0; iz < nz - 1; iz++) {
      const a = iz + ix * nz;
      const b = a + nz; // +x
      // Counter-clockwise seen from above, so the faces point up.
      indices.set([a, a + 1, b, b, a + 1, b + 1], o);
      o += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 1 }));
  ground.receiveShadow = true;
  return ground;
}
