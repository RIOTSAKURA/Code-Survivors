import { describe, expect, it } from 'vitest';
import { createRun } from '../src/core/state';
import {
  BOMB_BURN,
  BOMB_CHAIN,
  CLONE_FOCUS,
  CLONE_SPREAD,
  DART_BOUNCE,
  DART_FOCUS,
  EVOLUTION_DEFS,
  EVOLUTION_LEVEL,
  EVOLUTION_WEAPONS,
  ORBIT_REFLECT,
  ORBIT_WIDE,
  evolutionCandidates,
  evolutionsFor,
  isEvolutionWeapon,
} from '../src/data/evolutions';
import { applyEvolution, canEvolve, toEvolutionCard } from '../src/systems/progression';

describe('weapon evolutions', () => {
  it('ships two branches for every supported weapon and nothing else', () => {
    expect(EVOLUTION_WEAPONS).toEqual(['dart', 'orbit', 'bomb', 'clone']);
    for (const weapon of EVOLUTION_WEAPONS) {
      const options = evolutionsFor(weapon);
      expect(options).toHaveLength(2);
      expect(options.map((id) => EVOLUTION_DEFS[id].branch).sort()).toEqual(['A', 'B']);
      for (const id of options) expect(EVOLUTION_DEFS[id].weapon).toBe(weapon);
    }
    expect(evolutionsFor('ray')).toEqual([]);
    expect(isEvolutionWeapon('bomb')).toBe(true);
    expect(isEvolutionWeapon('clone')).toBe(true);
    expect(isEvolutionWeapon('ray')).toBe(false);
  });

  it('only unlocks at the evolution level and only once', () => {
    const run = createRun();
    run.weapons.dart = EVOLUTION_LEVEL - 1;
    expect(canEvolve(run, 'dart')).toBe(false);
    run.weapons.dart = EVOLUTION_LEVEL;
    expect(canEvolve(run, 'dart')).toBe(true);
    expect(applyEvolution(run, 'dart_bounce')).toBe('dart');
    expect(run.evolutions.dart).toBe('dart_bounce');
    expect(canEvolve(run, 'dart')).toBe(false);
    expect(applyEvolution(run, 'dart_stack')).toBeNull();
    expect(run.evolutions.dart).toBe('dart_bounce');
  });

  it('applies the bomb and clone branches', () => {
    const run = createRun();
    run.weapons.bomb = 1;
    run.weapons.clone = 1;
    expect(applyEvolution(run, 'bomb_chain')).toBe('bomb');
    expect(applyEvolution(run, 'clone_focus')).toBe('clone');
    expect(run.evolutions.bomb).toBe('bomb_chain');
    expect(run.evolutions.clone).toBe('clone_focus');
  });

  it('never evolves a weapon the player does not own', () => {
    const run = createRun();
    expect(canEvolve(run, 'orbit')).toBe(false);
    expect(applyEvolution(run, 'orbit_wide')).toBeNull();
    expect(run.evolutions.orbit).toBeUndefined();
  });

  it('lists owned, unevolved candidates and honours pending queues', () => {
    const run = createRun();
    run.weapons.dart = 3;
    run.weapons.orbit = 6;
    expect(evolutionCandidates(run)).toEqual(['dart', 'orbit']);
    expect(evolutionCandidates(run, ['dart'])).toEqual(['orbit']);
    run.evolutions.orbit = 'orbit_reflect';
    expect(evolutionCandidates(run, ['dart'])).toEqual([]);
  });

  it('builds EVOLVE cards with the branch label', () => {
    const card = toEvolutionCard('dart_bounce');
    expect(card.kind).toBe('evolution');
    expect(card.chip).toBe('EVOLVE');
    expect(card.label).toBe('BRANCH A');
    expect(card.desc.length).toBeGreaterThan(10);
  });

  it('keeps the two branches pulling in opposite directions', () => {
    expect(DART_BOUNCE.scale).toBeGreaterThan(0);
    expect(DART_BOUNCE.scale).toBeLessThan(1);
    expect(DART_FOCUS.maxStacks).toBeGreaterThan(0);
    expect(DART_FOCUS.perHit).toBeGreaterThan(0);
    expect(ORBIT_WIDE.radius).toBeGreaterThan(1);
    expect(ORBIT_WIDE.knockback).toBeGreaterThan(1);
    expect(ORBIT_REFLECT.radius).toBeLessThan(1);
    expect(ORBIT_REFLECT.damageScale).toBeGreaterThan(1.6);
    expect(BOMB_BURN.duration).toBeGreaterThan(1);
    expect(BOMB_BURN.dpsScale).toBeGreaterThan(0);
    expect(BOMB_BURN.radiusScale).toBeLessThan(1);
    expect(BOMB_CHAIN.depth).toBeGreaterThan(0);
    expect(BOMB_CHAIN.damageScale).toBeGreaterThan(0);
    expect(BOMB_CHAIN.damageScale).toBeLessThan(1);
    expect(CLONE_FOCUS.rangeScale).toBeGreaterThan(1);
    expect(CLONE_SPREAD.rangeScale).toBeGreaterThan(1);
  });
});
