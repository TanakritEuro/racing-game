import { describe, expect, it } from 'vitest';
import { quality, thin } from '../src/render/quality';

describe('graphics', () => {
  it('draws less on Low: pixels, shadows, trees, particles and rain', () => {
    const high = quality('high');
    const low = quality('low');
    expect(low.pixelRatio).toBeLessThan(high.pixelRatio);
    expect(low.shadowMap).toBeLessThan(high.shadowMap);
    for (const k of ['trees', 'particles', 'rain'] as const) expect(low[k]).toBeLessThan(high[k]);
    // Without a browser to ask (no touch screen), Auto is High.
    expect(quality('auto').level).toBe('high');
  });

  it('thins a list evenly, keeping the share asked for', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    expect(thin(items, 1)).toEqual(items);
    const kept = thin(items, 0.35);
    expect(kept.length).toBe(350);
    // Spread through the list, not the first 350.
    expect(kept[kept.length - 1]).toBeGreaterThan(990);
    expect(thin(items, 0)).toEqual([]);
  });
});
