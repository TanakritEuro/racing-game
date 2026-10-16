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
    this.view = new CarView(def, mounts, { colour: 0x9fd4ff, translucent: 0.35 });
    this.root = this.view.root;
  }

  /** Show `rec` at `t` seconds into its lap, or hide the ghost (no recording, out lap, or past its end). */
  update(rec: LapRecording | null, t: number | null, show: boolean): void {
    this.root.visible = show && rec !== null && t !== null && t <= duration(rec);
    if (!this.root.visible || !rec || t === null) return;
    sampleRecording(rec, t, this.state);
    this.view.update(this.state.pose);
  }
}
