// Player settings, remembered between visits in localStorage. Presentation only: the
// simulation gets them through its own setters (setAids, setGearboxMode).

import type { CameraMode } from './render/cameras';
import type { GearboxMode } from './vehicle/gearbox';

export interface Settings {
  abs: boolean;
  tc: boolean;
  steeringAssist: boolean;
  gearbox: GearboxMode;
  camera: CameraMode;
  ghost: boolean;
  /** Sound: master volume (0–1) and mute. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  abs: true,
  tc: true,
  steeringAssist: true,
  gearbox: 'auto',
  camera: 'chase',
  ghost: true,
  volume: 0.8,
  muted: false,
};

const KEY = 'racing.settings.v1';

/** Saved settings over the defaults. Storage can be missing or blocked (private windows): then the defaults. */
export function loadSettings(): Settings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...(typeof saved === 'object' && saved !== null ? saved : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered this time; the game works the same.
  }
}
