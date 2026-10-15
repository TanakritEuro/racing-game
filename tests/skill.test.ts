import { describe, expect, it } from 'vitest';
import { createAiDriver, type AiDriver } from '../src/ai/driver';
import { DIFFICULTIES, fieldSkills, PERFECT, type Skill } from '../src/ai/skill';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import { createRng } from '../src/math';
import { initPhysics } from '../src/physics';
import { Simulation } from '../src/sim';
import { TEST_CIRCUIT } from '../src/track/circuits';
import { buildTrack } from '../src/track/track';
import { KESTREL } from '../src/vehicle/cars';

const track = buildTrack(TEST_CIRCUIT);

/** A flying lap of the Proving Ground: its time and validity, and the driver. */
async function flyingLap(skill: Skill, seed = 1): Promise<{ time: number; valid: boolean; recoveries: number; ai: AiDriver }> {
  await initPhysics();
  const sim = new Simulation(track);
  const ai = createAiDriver(track, KESTREL, skill, seed);
  let recoveries = 0;
  for (let k = 0; k < 300 * 120 && sim.timer.laps < 2; k++) {
    sim.step(ai.drive(sim.car, PHYSICS_STEP));
    if (ai.stuck) {
      recoveries++;
      sim.recover();
      ai.recovered();
    }
  }
  expect(sim.timer.laps).toBe(2);
  return { time: sim.timer.lastLap!, valid: sim.timer.lastValid, recoveries, ai };
}

describe('skills', () => {
  it('spread a field across each difficulty’s ranges, the same for the same seed', () => {
    for (const d of DIFFICULTIES) {
      const skills = fieldSkills(d, 7, createRng(3));
      const R = TUNING.ai.difficulty[d];
      for (const s of skills) {
        expect(s.pace).toBeGreaterThanOrEqual(R.pace[0]);
        expect(s.pace).toBeLessThanOrEqual(R.pace[1]);
        expect(s.mistakes).toBeGreaterThanOrEqual(R.mistakes[0]);
        expect(s.mistakes).toBeLessThanOrEqual(R.mistakes[1]);
      }
      // Spread: the quickest and slowest are most of the range apart.
      const paces = skills.map((s) => s.pace);
      expect(Math.max(...paces) - Math.min(...paces)).toBeGreaterThan(0.6 * (R.pace[1] - R.pace[0]));
      expect(fieldSkills(d, 7, createRng(3))).toEqual(skills);
    }
    // Harder is quicker throughout.
    expect(TUNING.ai.difficulty.easy.pace[1]).toBeLessThanOrEqual(TUNING.ai.difficulty.medium.pace[0]);
    expect(TUNING.ai.difficulty.medium.pace[1]).toBeLessThanOrEqual(TUNING.ai.difficulty.hard.pace[0]);
  });

  it('make an easy driver clearly slower than a hard one', async () => {
    const hard = await flyingLap(fieldSkills('hard', 1, createRng(1))[0]);
    const easy = await flyingLap(fieldSkills('easy', 1, createRng(1))[0]);
    expect(easy.time).toBeGreaterThan(hard.time * 1.06);
    expect(hard.recoveries + easy.recoveries).toBe(0);
  }, 120_000);

  it('give the same lap for the same seed', async () => {
    const skill = fieldSkills('medium', 1, createRng(5))[0];
    const a = await flyingLap(skill, 9);
    const b = await flyingLap(skill, 9);
    expect(b.time).toBe(a.time);
  }, 120_000);

  it('make mistakes that cost time', async () => {
    const clean = await flyingLap({ ...PERFECT, pace: 0.9 });
    const sloppy = await flyingLap({ ...PERFECT, pace: 0.9, mistakes: 1 }, 4);
    expect(clean.ai.mistakesMade).toBe(0);
    expect(sloppy.ai.mistakesMade).toBeGreaterThan(5);
    expect(sloppy.time).toBeGreaterThan(clean.time);
    // ...but it recovers from them without help.
    expect(sloppy.recoveries).toBe(0);
  }, 120_000);
});
