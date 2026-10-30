import { describe, expect, it } from 'vitest';
import {
  CACHE_PASSIVE,
  GC_PASSIVE,
  PARALLEL_PASSIVE,
  PASSIVE_DEFS,
  TYPESAFE_PASSIVE,
} from '../src/data/passives';
import { WEAPON_DEFS } from '../src/data/weapons';

describe('conditional passive scaling', () => {
  it('keeps the cache window long enough for the slowest weapon to hold a stack', () => {
    expect(CACHE_PASSIVE.window).toBeGreaterThanOrEqual(WEAPON_DEFS.bomb.cooldown(1));
    expect(CACHE_PASSIVE.maxStacks).toBeGreaterThan(0);
    for (let level = 2; level <= 5; level++) {
      expect(CACHE_PASSIVE.perStack(level)).toBeGreaterThan(CACHE_PASSIVE.perStack(level - 1));
    }
    expect(CACHE_PASSIVE.perStack(5)).toBeLessThan(0.2);
  });

  it('scales the parallel alternation bonus upward', () => {
    for (let level = 2; level <= 5; level++) {
      expect(PARALLEL_PASSIVE.bonus(level)).toBeGreaterThan(PARALLEL_PASSIVE.bonus(level - 1));
    }
    expect(PARALLEL_PASSIVE.bonus(1)).toBeCloseTo(0.1, 6);
    expect(PARALLEL_PASSIVE.bonus(5)).toBeCloseTo(0.3, 6);
  });

  it('makes the garbage sweep easier and stronger with levels', () => {
    for (let level = 2; level <= 5; level++) {
      expect(GC_PASSIVE.threshold(level)).toBeLessThan(GC_PASSIVE.threshold(level - 1));
      expect(GC_PASSIVE.radius(level)).toBeGreaterThan(GC_PASSIVE.radius(level - 1));
      expect(GC_PASSIVE.damage(level)).toBeGreaterThan(GC_PASSIVE.damage(level - 1));
    }
    expect(GC_PASSIVE.threshold(5)).toBeGreaterThan(0);
    expect(GC_PASSIVE.window).toBeGreaterThan(0);
  });

  it('shortens the type-safe recharge without making it instant', () => {
    for (let level = 2; level <= 5; level++) {
      expect(TYPESAFE_PASSIVE.delay(level)).toBeLessThan(TYPESAFE_PASSIVE.delay(level - 1));
    }
    expect(TYPESAFE_PASSIVE.delay(5)).toBeGreaterThan(1);
    expect(TYPESAFE_PASSIVE.radius).toBeGreaterThan(0);
  });

  it('rewrites the four passive descriptions around their new mechanics', () => {
    expect(PASSIVE_DEFS.cache.desc).not.toContain('+20% 攻速');
    expect(PASSIVE_DEFS.parallel.desc).not.toContain('冷却');
    expect(PASSIVE_DEFS.gc.desc).not.toContain('拾取范围');
    expect(PASSIVE_DEFS.typesafe.desc).not.toContain('护甲');
    for (const id of ['cache', 'parallel', 'gc', 'typesafe'] as const) {
      expect(PASSIVE_DEFS[id].desc.length).toBeGreaterThan(8);
      expect(PASSIVE_DEFS[id].note.length).toBeGreaterThan(8);
    }
  });
});
