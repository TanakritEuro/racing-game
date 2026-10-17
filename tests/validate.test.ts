import { describe, expect, it } from 'vitest';
import { CIRCUITS } from '../src/track/circuits';
import { customDef, ovalTemplate, type CustomCircuit } from '../src/track/custom';
import { buildTrack } from '../src/track/track';
import { validateTrack, type Rule } from '../src/track/validate';

const rules = (c: CustomCircuit): Rule[] => validateTrack(buildTrack(customDef(c))).map((p) => p.rule);

/** The oval, changed by `change`. */
function oval(change: (c: CustomCircuit) => void): CustomCircuit {
  const c = ovalTemplate();
  change(c);
  return c;
}

describe('the circuit rules', () => {
  it('are kept by every built-in circuit and the blank oval', () => {
    for (const def of CIRCUITS) expect(validateTrack(buildTrack(def)), def.id).toEqual([]);
    expect(rules(ovalTemplate())).toEqual([]);
  });

  it('catch a corner tighter than 12 m, and say where', () => {
    // Pull one point of the far bend in, into a kink.
    const c = oval((o) => {
      o.points[5] = { x: o.points[5].x - 120, z: o.points[5].z };
    });
    const track = buildTrack(customDef(c));
    const p = validateTrack(track).find((q) => q.rule === 'radius')!;
    expect(p).toBeDefined();
    expect(p.at.length).toBeGreaterThan(0);
    expect(p.message).toMatch(/tighter than 12 m/);
  });

  it('catch a climb over 12 %, and banking over 12°', () => {
    expect(rules(oval((o) => (o.points[5].y = 40)))).toContain('grade');
    const banked = oval((o) => (o.points[5].bank = 0.3));
    // (Cleaned circuits never bank this far; a TrackDef straight from code can.)
    expect(rules(banked)).toContain('banking');
  });

  it('catch a circuit that comes too close to itself', () => {
    // Squash the oval until its straights' run-offs touch.
    const c = oval((o) => {
      for (const p of o.points) p.z *= 0.12;
    });
    expect(rules(c)).toContain('overlap');
  });

  it('catch a start line on a bend, and no room for the pits', () => {
    // Start at the middle of the far bend: no straight start, no pit lane.
    const c = oval((o) => {
      o.points = [...o.points.slice(5), ...o.points.slice(0, 5)];
    });
    const r = rules(c);
    expect(r).toContain('start');
    expect(r).toContain('pits');
  });

  it('catch a circuit too short', () => {
    const c = oval((o) => {
      for (const p of o.points) {
        p.x *= 0.3;
        p.z *= 0.3;
      }
    });
    expect(rules(c)).toContain('length');
  });
});
