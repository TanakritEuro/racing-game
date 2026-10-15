// The differential: splits the drive between the two driven wheels and lets them turn at
// different speeds in a corner. All three types are one model, a locking torque between
// the wheels that resists them turning at different speeds, capped at:
//   open:          0 (equal torque to each wheel; a wheel in the air takes it all)
//   locked:        no cap (both wheels at the same speed, like a solid axle)
//   limited-slip:  preload + ramp × |input torque| (a clutch-pack or Salisbury diff)

export interface DifferentialDef {
  type: 'open' | 'locked' | 'lsd';
  /** Locking torque with no drive or engine braking through it (N·m). */
  preload: number;
  /** Extra locking torque per newton-metre of input torque. */
  ramp: number;
}

/** The most torque the differential can move between the wheels (N·m), given the torque coming into it. */
export function lockingTorque(def: DifferentialDef, inputTorque: number): number {
  switch (def.type) {
    case 'open':
      return 0;
    case 'locked':
      return Infinity;
    case 'lsd':
      return def.preload + def.ramp * Math.abs(inputTorque);
  }
}
