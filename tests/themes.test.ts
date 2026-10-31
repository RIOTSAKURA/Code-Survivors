import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/config';
import { ENEMY_DEFS } from '../src/data/enemies';
import {
  COMBAT_THEMES,
  pickThemedEnemyType,
  themeAt,
  themeCapBonus,
  themeCycleLength,
  themeSpawnWeights,
} from '../src/data/themes';

describe('combat themes', () => {
  it('starts no earlier than the late game gate', () => {
    expect(themeAt(0)).toBeNull();
    expect(themeAt(COMBAT.startAt - 1)).toBeNull();
    expect(themeAt(COMBAT.startAt)).not.toBeNull();
  });

  it('cycles through every segment and wraps cleanly', () => {
    const first = themeAt(COMBAT.startAt);
    expect(first?.def.id).toBe(COMBAT_THEMES[0].id);
    expect(themeCycleLength()).toBe(
      COMBAT_THEMES.reduce((sum, theme) => sum + theme.duration, 0),
    );
    const wrapped = themeAt(COMBAT.startAt + themeCycleLength());
    expect(wrapped?.def.id).toBe(first?.def.id);
    expect(wrapped?.index).toBe(first?.index);
  });

  it('keeps a window between combat segments', () => {
    const breather = COMBAT_THEMES.find((theme) => theme.id === 'breather');
    expect(breather).toBeDefined();
    expect(breather!.spawnRate).toBeLessThan(0.7);
    expect(breather!.duration).toBeGreaterThan(10);
  });

  it('biases each themed segment toward its intended enemies', () => {
    const support = COMBAT_THEMES.find((theme) => theme.id === 'support')!;
    const route = COMBAT_THEMES.find((theme) => theme.id === 'route')!;
    const cleanup = COMBAT_THEMES.find((theme) => theme.id === 'cleanup')!;
    expect(themeSpawnWeights(support, 300).daemon).toBeGreaterThan(
      themeSpawnWeights(support, 300).syntax!,
    );
    expect(themeSpawnWeights(route, 300).deadlock).toBeGreaterThan(
      themeSpawnWeights(route, 300).syntax!,
    );
    expect(themeSpawnWeights(route, 300).breakpoint).toBeGreaterThan(
      themeSpawnWeights(route, 300).syntax!,
    );
    expect(themeSpawnWeights(cleanup, 300).syntax).toBeGreaterThan(
      themeSpawnWeights(cleanup, 300).memleak!,
    );
    expect(themeCapBonus(support, 'daemon')).toBeGreaterThan(0);
    expect(themeCapBonus(route, 'breakpoint')).toBeGreaterThan(0);
  });

  it('only picks unlocked enemies from the themed pool', () => {
    for (const theme of COMBAT_THEMES) {
      for (let t = 200; t <= 600; t += 20) {
        for (let i = 0; i < 20; i++) {
          const id = pickThemedEnemyType(theme, t, i / 20);
          expect(ENEMY_DEFS[id].unlockAt).toBeLessThanOrEqual(t);
        }
      }
    }
  });

  it('keeps cleanup fragile and support dangerous', () => {
    const cleanup = COMBAT_THEMES.find((theme) => theme.id === 'cleanup')!;
    const support = COMBAT_THEMES.find((theme) => theme.id === 'support')!;
    expect(cleanup.hpScale).toBeLessThan(1);
    expect(cleanup.spawnRate).toBeGreaterThan(support.spawnRate);
    expect(support.hpScale).toBe(1);
  });
});
