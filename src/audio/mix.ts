// What each sound should be doing, from the car's state: pure functions, so the mix can be
// tested without a browser. The audio nodes (audio/carVoice.ts) just follow these numbers.

import type { EngineDef } from '../vehicle/engine';

/** Levels and tone. Gains are before the master volume. */
export const MIX = {
  engine: {
    /** Gain at idle with the throttle shut, extra at full throttle, extra at the limiter's RPM. */
    idle: 0.16,
    throttle: 0.3,
    revs: 0.16,
    /** Low-pass cut-off: this many harmonics of the firing frequency shut, plus more with throttle. */
    harmonics: 4,
    throttleHarmonics: 9,
    /** The limiter: this close to it (RPM) with the throttle past half, it stutters. */
    limiterBand: 150,
  },
  squeal: { gain: 0.32, pitch: 750, pitchSlide: 450, fullSpeed: 10 },
  wind: { gain: 0.32, fullSpeed: 65, cutoff: 350, cutoffPerSpeed: 22 },
  /** Kerb ridges are a metre apart. */
  rumble: { gain: 0.3, ridgeSpacing: 1, fullSpeed: 15 },
  /** An impulse (N·s) this big is a full-volume crash; touches scale with its square root. */
  impact: { full: 6000, gain: 0.9 },
  /** Other cars: full volume within this distance (m), quieter with distance squared beyond it. */
  distance: 12,
  /** Rain falling (wet only); tyres through water (gain at full speed, cut-off from slow to fast); squeal left on a wet road. */
  rain: { gain: 0.09 },
  swish: { gain: 0.24, fullSpeed: 40, cutoff: [500, 2600] },
  wetSqueal: 0.25,
};

/** Rain falling: only when it's raining (fully wet). */
export function rainHiss(wet: number): { gain: number } {
  return { gain: wet >= 1 ? MIX.rain.gain : 0 };
}

/** Tyres through the water on the road, at `speed` (m/s) on a road `wet` (0–1). */
export function swish(wet: number, speed: number): { gain: number; cutoff: number } {
  const S = MIX.swish;
  const f = Math.min(1, Math.abs(speed) / S.fullSpeed);
  return { gain: S.gain * wet * f, cutoff: S.cutoff[0] + (S.cutoff[1] - S.cutoff[0]) * f };
}

export interface EngineVoice {
  /** Firing frequency (Hz): RPM ÷ 60 × cylinders ÷ 2. */
  fundamental: number;
  gain: number;
  /** Low-pass cut-off (Hz). */
  brightness: number;
  limiter: boolean;
}

/** The engine's voice at `rpm` with `throttle` (0–1). */
export function engineVoice(def: EngineDef, rpm: number, throttle: number): EngineVoice {
  const E = MIX.engine;
  const fundamental = (Math.max(rpm, 1) / 60) * (def.cylinders / 2);
  const revs = Math.min(1, rpm / def.limiterRpm);
  return {
    fundamental,
    gain: E.idle + E.throttle * throttle + E.revs * revs,
    brightness: fundamental * (E.harmonics + E.throttleHarmonics * throttle),
    limiter: throttle > 0.5 && rpm > def.limiterRpm - E.limiterBand,
  };
}

/** Tyre squeal: from how far past their grip the tyres are (0 = gripping) and the speed. */
export function squeal(slide: number, speed: number, wet = 0): { gain: number; pitch: number } {
  const S = MIX.squeal;
  const s = Math.min(1, slide);
  // A wet tyre hardly squeals.
  const muffle = 1 - (1 - MIX.wetSqueal) * wet;
  return { gain: S.gain * Math.min(1, s * 1.5) * Math.min(1, speed / S.fullSpeed) * muffle, pitch: S.pitch + S.pitchSlide * s };
}

/** Wind: rising with speed squared, brighter as it rises. */
export function wind(speed: number): { gain: number; cutoff: number } {
  const W = MIX.wind;
  return { gain: W.gain * Math.min(1, (speed / W.fullSpeed) ** 2), cutoff: W.cutoff + W.cutoffPerSpeed * speed };
}

/** Kerb rumble: `wheels` on a kerb at `speed`. */
export function rumble(wheels: number, speed: number): { gain: number; frequency: number } {
  const R = MIX.rumble;
  return { gain: (R.gain * Math.min(2, wheels)) / 2 * Math.min(1, speed / R.fullSpeed), frequency: speed / R.ridgeSpacing };
}

/** A knock's loudness (0–1) from its impulse. */
export function impact(impulse: number): number {
  return MIX.impact.gain * Math.min(1, Math.sqrt(impulse / MIX.impact.full));
}

/** How loud another car is at `distance` (m). */
export function distanceGain(distance: number): number {
  return 1 / (1 + Math.max(0, distance / MIX.distance - 1) ** 2);
}
