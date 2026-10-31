import { describe, expect, it } from 'vitest';
import { RAY_LOCK } from '../src/config';
import { createRun } from '../src/core/state';
import { WEAPON_DEFS } from '../src/data/weapons';
import { focusChainMaxStacks, focusChainWindow, usesFocusTarget } from '../src/systems/focus';

describe('focus chain', () => {
  it('keeps the ray lock window longer than the slowest ray cooldown', () => {
    const run = createRun();
    run.weapons.ray = 8;
    run.evolutions.ray = 'ray_lock';
    expect(usesFocusTarget(run)).toBe(true);
    expect(focusChainWindow(run)).toBe(RAY_LOCK.window);
    expect(focusChainWindow(run)).toBeGreaterThan(WEAPON_DEFS.ray.cooldown(8));
    expect(focusChainMaxStacks(run)).toBe(RAY_LOCK.maxStacks);
    expect(RAY_LOCK.cooldown).toBeGreaterThan(0.4);
    expect(RAY_LOCK.cooldown).toBeLessThan(1);
  });

  it('shares the same chain with cache and focused darts', () => {
    const run = createRun();
    run.passives.cache = 1;
    expect(usesFocusTarget(run)).toBe(true);
    expect(focusChainWindow(run)).toBeGreaterThanOrEqual(3);
    run.evolutions.dart = 'dart_stack';
    expect(focusChainMaxStacks(run)).toBeGreaterThanOrEqual(6);
  });

  it('does not mark targets for unrelated builds', () => {
    const run = createRun();
    run.weapons.dart = 8;
    expect(usesFocusTarget(run)).toBe(false);
  });
});
