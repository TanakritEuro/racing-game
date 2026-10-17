// How much the renderer draws: High (a laptop) or Low (a phone), or Auto (Low on a small touch
// screen, High otherwise). Only what's drawn changes, never the simulation: the pixel ratio,
// antialiasing, the shadow map, how many trees, how many particles and how much rain.

import { TUNING } from '../config';

export type Graphics = 'auto' | 'high' | 'low';

export interface Quality {
  level: 'high' | 'low';
  /** The most device pixels per CSS pixel drawn, and antialiasing. */
  pixelRatio: number;
  antialias: boolean;
  /** Shadow map size (px). */
  shadowMap: number;
  /** Shares of the trees, the smoke and spray, and the rain drawn (0–1). */
  trees: number;
  particles: number;
  rain: number;
}

/** A small touch screen: a phone. */
export function isPhone(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < TUNING.effects.quality.phoneSide;
  } catch {
    return false;
  }
}

export function quality(graphics: Graphics): Quality {
  const level = graphics === 'auto' ? (isPhone() ? 'low' : 'high') : graphics;
  return { level, ...TUNING.effects.quality[level] };
}

/** Every `share` of a list (spread evenly through it): the trees a Low view keeps. */
export function thin<T>(items: readonly T[], share: number): T[] {
  if (share >= 1) return [...items];
  return items.filter((_, i) => Math.floor((i + 1) * share) > Math.floor(i * share));
}
