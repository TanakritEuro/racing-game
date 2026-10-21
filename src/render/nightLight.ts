// Floodlight at night, baked: every vertex of the track, terrain and scenery gets the light the
// floodlight towers give it (`track/floodlights.ts`), as an attribute, once. A patch to the
// materials adds it to the surface as emitted light, scaled by one uniform the lighting turns
// up as night falls. Lit materials glow with their own colour where the towers reach; unlit
// ones (painted lines, decals) are dimmed in the dark and brought back up under the lights.

import * as THREE from 'three';
import type { FloodlightField } from '../track/floodlights';

/** Shared by every patched material: how much of the baked light shows (0 by day), and how bright unlit things are (1 by day). */
export const nightUniforms = {
  uFlood: { value: 0 },
  uUnlit: { value: 1 },
};

const patched = new WeakSet<THREE.Material>();

/** Teach a material the baked floodlight (once). */
function patch(material: THREE.Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const lit = !(material instanceof THREE.MeshBasicMaterial);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlood = nightUniforms.uFlood;
    shader.uniforms.uUnlit = nightUniforms.uUnlit;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlood;\nvarying float vFlood;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlood = aFlood;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFlood;\nuniform float uUnlit;\nvarying float vFlood;');
    shader.fragmentShader = lit
      ? shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vFlood * uFlood;')
      : shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= min(1.0, uUnlit + vFlood * uFlood);');
  };
  material.customProgramCacheKey = () => (lit ? 'flood-lit' : 'flood-unlit');
  material.needsUpdate = true;
}

const v = new THREE.Vector3();
const m = new THREE.Matrix4();

/** Bake the floodlight into every mesh under `root` (instanced meshes per instance), and patch their materials. */
export function bakeFloodlight(root: THREE.Object3D, field: FloodlightField): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    if (o instanceof THREE.InstancedMesh) {
      const light = new Float32Array(o.count);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
        light[i] = field.at(v.x, v.z);
      }
      geo.setAttribute('aFlood', new THREE.InstancedBufferAttribute(light, 1));
    } else {
      const light = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        light[i] = field.at(v.x, v.z);
      }
      geo.setAttribute('aFlood', new THREE.BufferAttribute(light, 1));
    }
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) patch(mat);
  });
}
