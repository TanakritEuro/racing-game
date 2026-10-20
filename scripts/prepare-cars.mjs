// Copies the car models the game uses out of Kenney's Car Kit into public/models/cars/.
//
// Usage (after downloading kenney_car-kit.zip from https://kenney.nl/assets/car-kit and
// extracting it):
//   node scripts/prepare-cars.mjs "path/to/Models/GLB format"
// Writes public/models/cars/<model>.glb and the shared Textures/colormap.png they refer to.
// See ASSETS.md for the licence (CC0). No dependencies: the files are copied as they are.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The kit's models the game uses (see src/render/carModels.ts for which car gets which). */
const MODELS = ['hatchback-sports', 'sedan', 'sedan-sports', 'suv', 'race-future'];

const from = process.argv[2];
if (!from || !existsSync(join(from, 'sedan.glb'))) {
  console.error('Usage: node scripts/prepare-cars.mjs "path/to/Models/GLB format"');
  process.exit(1);
}
const to = 'public/models/cars';
mkdirSync(join(to, 'Textures'), { recursive: true });
for (const name of MODELS) {
  copyFileSync(join(from, `${name}.glb`), join(to, `${name}.glb`));
  console.log(`${name}.glb`, statSync(join(to, `${name}.glb`)).size, 'bytes');
}
copyFileSync(join(from, 'Textures', 'colormap.png'), join(to, 'Textures', 'colormap.png'));
console.log('Textures/colormap.png', statSync(join(to, 'Textures', 'colormap.png')).size, 'bytes');
