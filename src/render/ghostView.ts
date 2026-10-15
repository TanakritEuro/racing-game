import * as THREE from 'three';
import type { Vec3 } from '../math';
import { createRecordedState, duration, sampleRecording, type LapRecording } from '../race/recording';
import type { CarDef } from '../vehicle/carDef';
import { CarView } from './carView';

/** The ghost: the car view, translucent and shadowless, drawn from a lap recording. */
export class GhostView {
  readonly root: THREE.Object3D;
  private readonly view: CarView;
  private readonly state = createRecordedState();

  constructor(def: CarDef, mounts: readonly Vec3[]) {
    this.view = new CarView(def, mounts, 0x9fd4ff);
    this.root = this.view.root;
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = o.receiveShadow = false;
      const m = (o.material as THREE.Material).clone();
      m.transparent = true;
      m.opacity = 0.35;
      m.depthWrite = false;
      o.material = m;
    });
  }

  /** Show `rec` at `t` seconds into its lap, or hide the ghost (no recording, out lap, or past its end). */
  update(rec: LapRecording | null, t: number | null, show: boolean): void {
    this.root.visible = show && rec !== null && t !== null && t <= duration(rec);
    if (!this.root.visible || !rec || t === null) return;
    sampleRecording(rec, t, this.state);
    this.view.update(this.state.pose);
  }
}
