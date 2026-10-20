// A car's setup: clicks around the car's own numbers (0 is the car as designed), turned into
// an adjusted `CarDef` that the vehicle model is built from like any other. The click sizes
// are in TUNING.setup; every setting is clamped, so no setup can break the physics. Pure.

import { TUNING } from '../config';
import { AIR_DENSITY, GRAVITY } from '../constants';
import { drivenTyre, type CarDef, type SuspensionDef } from './carDef';
import { fullThrottleTorque, RPM_PER_RAD_S } from './engine';

export type SettingId =
  | 'springsFront'
  | 'springsRear'
  | 'antiRollFront'
  | 'antiRollRear'
  | 'dampers'
  | 'rideHeight'
  | 'wingFront'
  | 'wingRear'
  | 'brakeBias'
  | 'diff'
  | 'centreSplit'
  | 'gearing';

/** Clicks from the car's own value for each setting (−5..5); a missing setting is 0. */
export type Setup = Partial<Record<SettingId, number>>;

export interface SettingDef {
  id: SettingId;
  label: string;
  /** Which group it is shown in. */
  group: 'Suspension' | 'Aero' | 'Brakes and drivetrain';
  /** What a click up does, in a few words, and what the extremes are called. */
  more: string;
  low: string;
  high: string;
  /** Change `def` (a copy) by `clicks`. */
  apply(def: CarDef, clicks: number): void;
  /** Only for some cars (the centre split: all-wheel drive); every car if not given. */
  only?(def: CarDef): boolean;
}

/** The settings `def` has (the centre split only on an all-wheel-drive car). */
export function settingsFor(def: CarDef): SettingDef[] {
  return SETTINGS.filter((s) => !s.only || s.only(def));
}

/** Springs at one end: the rate, with the dampers scaled to keep the same damping ratio. */
function springs(s: SuspensionDef, clicks: number): void {
  const k = Math.max(0.2, 1 + TUNING.setup.spring * clicks);
  s.stiffness *= k;
  s.bump *= Math.sqrt(k);
  s.rebound *= Math.sqrt(k);
}

/** Downforce at one end (as a share of the car's own), with the drag a wing brings. */
function wing(def: CarDef, end: 'front' | 'rear', clicks: number): void {
  const S = TUNING.setup;
  const before = def.aero.lift[end];
  const after = Math.min(0, before * Math.max(0, 1 + S.wing * clicks));
  def.aero.lift[end] = after;
  def.aero.dragArea = Math.max(0.1, def.aero.dragArea + S.wingDrag * (before - after));
}

export const SETTINGS: readonly SettingDef[] = [
  {
    id: 'springsFront',
    label: 'Front springs',
    group: 'Suspension',
    more: 'sharper turn-in, less grip over bumps',
    low: 'soft',
    high: 'stiff',
    apply: (def, c) => springs(def.suspension.front, c),
  },
  {
    id: 'springsRear',
    label: 'Rear springs',
    group: 'Suspension',
    more: 'more rotation, less traction over bumps',
    low: 'soft',
    high: 'stiff',
    apply: (def, c) => springs(def.suspension.rear, c),
  },
  {
    id: 'antiRollFront',
    label: 'Front anti-roll bar',
    group: 'Suspension',
    more: 'more understeer, less roll',
    low: 'soft',
    high: 'stiff',
    apply: (def, c) => (def.suspension.front.antiRoll *= Math.max(0, 1 + TUNING.setup.antiRoll * c)),
  },
  {
    id: 'antiRollRear',
    label: 'Rear anti-roll bar',
    group: 'Suspension',
    more: 'more oversteer, less roll',
    low: 'soft',
    high: 'stiff',
    apply: (def, c) => (def.suspension.rear.antiRoll *= Math.max(0, 1 + TUNING.setup.antiRoll * c)),
  },
  {
    id: 'dampers',
    label: 'Dampers',
    group: 'Suspension',
    more: 'quicker response, more nervous over bumps',
    low: 'soft',
    high: 'firm',
    apply: (def, c) => {
      const k = Math.max(0.2, 1 + TUNING.setup.dampers * c);
      for (const s of [def.suspension.front, def.suspension.rear]) {
        s.bump *= k;
        s.rebound *= k;
      }
    },
  },
  {
    id: 'rideHeight',
    label: 'Ride height',
    group: 'Suspension',
    more: 'less likely to bottom out, more roll',
    low: 'low',
    high: 'high',
    apply: (def, c) => {
      for (const s of [def.suspension.front, def.suspension.rear]) s.restLength += TUNING.setup.rideHeight * c;
    },
  },
  {
    id: 'wingFront',
    label: 'Front wing',
    group: 'Aero',
    more: 'more front grip at speed (less understeer), more drag',
    low: 'less',
    high: 'more',
    apply: (def, c) => wing(def, 'front', c),
  },
  {
    id: 'wingRear',
    label: 'Rear wing',
    group: 'Aero',
    more: 'more rear grip at speed (more stable), more drag',
    low: 'less',
    high: 'more',
    apply: (def, c) => wing(def, 'rear', c),
  },
  {
    id: 'brakeBias',
    label: 'Brake bias',
    group: 'Brakes and drivetrain',
    more: 'more to the front: stable under braking, slower to turn',
    low: 'rearward',
    high: 'forward',
    apply: (def, c) => {
      const B = TUNING.setup.brakeBias;
      def.brakes.frontBias = Math.min(B.max, Math.max(B.min, def.brakes.frontBias + B.step * c));
    },
  },
  {
    id: 'diff',
    label: 'Differential',
    group: 'Brakes and drivetrain',
    more: 'better traction out of slow corners, more understeer',
    low: 'open',
    high: 'locked',
    apply: (def, c) => {
      const D = TUNING.setup.diff;
      const d = def.differential;
      if (d.type !== 'lsd') return;
      d.preload = Math.max(0, d.preload * (1 + D.preload * c));
      d.ramp = Math.min(1, Math.max(0, d.ramp + D.ramp * c));
    },
  },
  {
    id: 'centreSplit',
    label: 'Centre split',
    group: 'Brakes and drivetrain',
    more: 'more drive to the front: stable on the power, more understeer',
    low: 'rear',
    high: 'front',
    only: (def) => def.drivetrain.layout === 'awd' && def.drivetrain.centre !== undefined,
    apply: (def, c) => {
      const centre = def.drivetrain.centre;
      if (def.drivetrain.layout !== 'awd' || !centre) return;
      const S = TUNING.setup.centreSplit;
      centre.split = Math.min(S.max, Math.max(S.min, centre.split + S.step * c));
    },
  },
  {
    id: 'gearing',
    label: 'Gearing',
    group: 'Brakes and drivetrain',
    more: 'shorter: quicker acceleration, lower top speed',
    low: 'long',
    high: 'short',
    apply: (def, c) => (def.gearbox.finalDrive *= 1 + TUNING.setup.gearing * c),
  },
];

const IDS = new Set<string>(SETTINGS.map((s) => s.id));

/** A setup from anywhere (storage, an older version): unknown settings dropped, clicks whole and in range, zeros left out. */
export function cleanSetup(raw: unknown): Setup {
  const out: Setup = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const C = TUNING.setup.clicks;
  for (const [id, v] of Object.entries(raw)) {
    if (!IDS.has(id) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const clicks = Math.max(-C, Math.min(C, Math.round(v)));
    if (clicks !== 0) out[id as SettingId] = clicks;
  }
  return out;
}

/** The car with `setup` applied: a new definition (the original is untouched). */
export function applySetup(def: CarDef, setup: Setup): CarDef {
  const clean = cleanSetup(setup);
  if (Object.keys(clean).length === 0) return def;
  const out = structuredClone(def);
  for (const s of SETTINGS) {
    const clicks = clean[s.id];
    if (clicks) s.apply(out, clicks);
  }
  return out;
}

/** What a setup does, in numbers the garage shows. */
export interface SetupReadout {
  /** The front axle's share of the roll stiffness (springs and bar): more is more understeer. */
  frontRollShare: number;
  /** Downforce at 200 km/h (N), and the front axle's share of it. */
  downforce200: number;
  downforceFront: number;
  /** Top speed where the power meets drag and rolling resistance, or the limiter in top gear (m/s). */
  topSpeed: number;
  /** The front axle's share of the brake torque. */
  brakeBias: number;
  /** All-wheel drive: the front axle's share of the drive torque (null for two-wheel drive). */
  centreSplit: number | null;
}

export function setupReadout(def: CarDef): SetupReadout {
  const t = 2 * def.trackHalf;
  const roll = (s: SuspensionDef) => (s.stiffness * t * t) / 2 + s.antiRoll * t * t;
  const front = roll(def.suspension.front);
  const v200 = 200 / 3.6;
  const area = -(def.aero.lift.front + def.aero.lift.rear);
  return {
    frontRollShare: front / (front + roll(def.suspension.rear)),
    downforce200: 0.5 * AIR_DENSITY * area * v200 * v200,
    downforceFront: area > 0 ? -def.aero.lift.front / area : 0.5,
    topSpeed: topSpeed(def),
    brakeBias: def.brakes.frontBias,
    centreSplit: def.drivetrain.layout === 'awd' ? (def.drivetrain.centre?.split ?? 0.5) : null,
  };
}

/** The highest speed some gear can hold at full throttle, below the limiter (m/s). */
function topSpeed(def: CarDef): number {
  const { gearbox, engine, aero } = def;
  const radius = drivenTyre(def).radius;
  const weight = def.mass * -GRAVITY;
  const rolling = def.tyres.rear.rollingResistance;
  const area = -(aero.lift.front + aero.lift.rear);
  let best = 0;
  for (let v = 1; v < 150; v += 0.25) {
    const resist = 0.5 * AIR_DENSITY * aero.dragArea * v * v + rolling * (weight + 0.5 * AIR_DENSITY * area * v * v);
    const holds = gearbox.ratios.some((ratio) => {
      const rpm = (v / radius) * ratio * gearbox.finalDrive * RPM_PER_RAD_S;
      return rpm <= engine.limiterRpm && (fullThrottleTorque(engine, rpm) * ratio * gearbox.finalDrive * gearbox.efficiency) / radius >= resist;
    });
    if (!holds) break;
    best = v;
  }
  return best;
}
