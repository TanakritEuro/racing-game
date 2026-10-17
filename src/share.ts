// A custom circuit packed into a link and back: compact JSON (points as numbers rounded to a
// decimetre, in one flat array) in URL-safe base64. A link from anyone is unpacked through
// `cleanCustom`, and refused if it's too long or isn't one.

import { cleanCustom, type CustomCircuit } from './track/custom';

/** The longest packed circuit accepted (characters). */
export const MAX_PACKED = 8000;

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/** The circuit as a short URL-safe string. */
export function packCircuit(c: CustomCircuit): string {
  // Each point: x, z, y, bank (milliradians), width (0 = the circuit's).
  const points = c.points.flatMap((p) => [round(p.x, 1), round(p.z, 1), round(p.y ?? 0, 1), Math.round((p.bank ?? 0) * 1000), round(p.width ?? 0, 1)]);
  const data = [1, c.name, c.width, c.runoff.width, c.runoff.surface === 'gravel' ? 1 : 0, c.hills, c.trees, c.pitSide === 'right' ? 1 : 0, c.kerbs ? 1 : 0, c.gravel ? 1 : 0, points];
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A circuit from a packed string, or null if it isn't one (or is too long). */
export function unpackCircuit(packed: string): CustomCircuit | null {
  if (packed.length > MAX_PACKED || !/^[A-Za-z0-9_-]+$/.test(packed)) return null;
  try {
    const binary = atob(packed.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(data) || data[0] !== 1 || data.length !== 11 || !Array.isArray(data[10]) || data[10].length % 5 !== 0) return null;
    const [, name, width, runoffWidth, gravelRunoff, hills, trees, right, kerbs, gravel, flat] = data as [number, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown[]];
    const points = [];
    for (let i = 0; i < flat.length; i += 5) {
      const [x, z, y, bank, w] = flat.slice(i, i + 5);
      points.push({ x, z, y, bank: typeof bank === 'number' ? bank / 1000 : bank, width: w === 0 ? undefined : w });
    }
    return cleanCustom({
      version: 1,
      name,
      points,
      width,
      runoff: { width: runoffWidth, surface: gravelRunoff === 1 ? 'gravel' : 'grass' },
      hills,
      trees,
      pitSide: right === 1 ? 'right' : 'left',
      kerbs: kerbs === 1,
      gravel: gravel === 1,
    });
  } catch {
    return null;
  }
}
