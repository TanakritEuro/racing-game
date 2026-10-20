// Upgrades bought in a career: four kinds, three levels each, changing a car's numbers the
// way a setup does (a new `CarDef`; the original untouched). Only the player's car carries
// them; the AI drives its car as designed. Pure.

import { TUNING } from '../config';
import type { CarDef } from './carDef';

export type UpgradeKind = 'engine' | 'tyres' | 'weight' | 'brakes';
export type Upgrades = Record<UpgradeKind, number>;

export const UPGRADE_KINDS: readonly UpgradeKind[] = ['engine', 'tyres', 'weight', 'brakes'];

export const UPGRADE_NAMES: Record<UpgradeKind, { name: string; does: string }> = {
  engine: { name: 'Engine', does: 'more torque everywhere' },
  tyres: { name: 'Tyres', does: 'more grip' },
  weight: { name: 'Weight', does: 'a lighter car' },
  brakes: { name: 'Brakes', does: 'more braking torque' },
};

export function noUpgrades(): Upgrades {
  return { engine: 0, tyres: 0, weight: 0, brakes: 0 };
}

/** Upgrades from anywhere, each a whole level within range. */
export function cleanUpgrades(raw: unknown): Upgrades {
  const out = noUpgrades();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  for (const k of UPGRADE_KINDS) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.min(TUNING.upgrades.levels, Math.round(v)));
  }
  return out;
}

/** The car with `upgrades` fitted (the same object when there are none). */
export function applyUpgrades(def: CarDef, upgrades: Upgrades): CarDef {
  const u = cleanUpgrades(upgrades);
  if (UPGRADE_KINDS.every((k) => u[k] === 0)) return def;
  const U = TUNING.upgrades;
  const out = structuredClone(def);
  if (u.engine > 0) {
    const k = 1 + U.engine * u.engine;
    out.engine.torqueCurve = out.engine.torqueCurve.map(([rpm, nm]) => [rpm, nm * k] as [number, number]);
  }
  if (u.tyres > 0) {
    const k = 1 + U.tyres * u.tyres;
    out.tyres.front.mu *= k;
    out.tyres.rear.mu *= k;
  }
  if (u.weight > 0) out.mass -= U.weight * u.weight;
  if (u.brakes > 0) out.brakes.maxTorque *= 1 + U.brakes * u.brakes;
  return out;
}

/** What the next level of `kind` costs, or null at the top level. */
export function upgradePrice(kind: UpgradeKind, level: number): number | null {
  const U = TUNING.upgrades;
  return level >= U.levels ? null : U.price[kind] * (level + 1);
}
