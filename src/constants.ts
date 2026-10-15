// Fixed physical constants, in metres / kilograms / seconds. Gameplay and car knobs live in config.ts.
//
// World axes: +Y up, the ground is y = 0. Car local frame: +X right, +Y up, -Z forward
// (the same "forward is -Z" convention as Three.js cameras and objects).

export const GRAVITY = -9.81;

/**
 * Physics runs at 120 Hz: tyre forces are stiff, and at 60 Hz they oscillate at low speed.
 * Rendering is variable-rate on top of this.
 */
export const PHYSICS_STEP = 1 / 120;

export const AIR_DENSITY = 1.2; // kg/m³ at sea level, ~20 °C
