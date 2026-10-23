import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { createRun } from '../src/core/state';
import { PASSIVE_DEFS, PASSIVE_IDS } from '../src/data/passives';
import { WEAPON_DEFS, WEAPON_IDS } from '../src/data/weapons';
import { applyUpgrade, pickChoices, toCard, xpForLevel } from '../src/systems/progression';

describe('xp curve', () => {
  it('is strictly increasing', () => {
    for (let level = 1; level < 60; level++) {
      expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level));
    }
  });

  it('gives an early first level up without being instant', () => {
    expect(xpForLevel(1)).toBeGreaterThanOrEqual(10);
    expect(xpForLevel(1)).toBeLessThanOrEqual(16);
  });

  it('keeps the early game deliberately slow without exploding later', () => {
    let early = 0;
    for (let level = 1; level <= 5; level++) early += xpForLevel(level);
    expect(early).toBeGreaterThanOrEqual(100);
    expect(early).toBeLessThanOrEqual(140);
    expect(xpForLevel(20) / xpForLevel(1)).toBeLessThan(15);
  });
});

describe('pickChoices', () => {
  it('offers weapons only for the opening pick', () => {
    const run = createRun();
    const rng = new Rng(7);
    const choices = pickChoices(run, rng, 3);
    expect(choices).toHaveLength(3);
    for (const id of choices) expect(WEAPON_IDS).toContain(id);
  });

  it('never repeats a choice', () => {
    const run = createRun();
    const rng = new Rng(11);
    for (let i = 0; i < 200; i++) {
      const choices = pickChoices(run, rng, 3);
      expect(new Set(choices).size).toBe(choices.length);
    }
  });

  it('mixes owned upgrades and new options once a weapon exists', () => {
    const run = createRun();
    run.weapons.dart = 1;
    const rng = new Rng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      for (const id of pickChoices(run, rng, 3)) seen.add(id);
    }
    expect(seen.size).toBeGreaterThan(6);
    expect(seen.has('dart')).toBe(true);
  });

  it('excludes maxed entries', () => {
    const run = createRun();
    for (const id of WEAPON_IDS) run.weapons[id] = WEAPON_DEFS[id].maxLevel;
    for (const id of PASSIVE_IDS) run.passives[id] = PASSIVE_DEFS[id].maxLevel;
    const choices = pickChoices(run, new Rng(5), 3);
    expect(choices).toHaveLength(0);
  });

  it('stops offering new weapons once all six are owned', () => {
    const run = createRun();
    for (const id of WEAPON_IDS) run.weapons[id] = 1;
    const rng = new Rng(9);
    for (let i = 0; i < 100; i++) {
      const choices = pickChoices(run, rng, 3);
      for (const id of choices) {
        const offeredAsNewWeapon =
          WEAPON_IDS.includes(id as never) && ((run.weapons as Record<string, number>)[id] ?? 0) === 0;
        expect(offeredAsNewWeapon).toBe(false);
      }
    }
  });
});

describe('applyUpgrade', () => {
  it('levels a weapon and clamps at max level', () => {
    const run = createRun();
    for (let i = 0; i < 20; i++) applyUpgrade(run, 'dart');
    expect(run.weapons.dart).toBe(WEAPON_DEFS.dart.maxLevel);
  });

  it('applies passive stat changes', () => {
    const run = createRun();
    const baseSpeed = run.stats.speed;
    applyUpgrade(run, 'compile');
    expect(run.stats.speed).toBeCloseTo(baseSpeed * 1.15);

    applyUpgrade(run, 'typesafe');
    expect(run.stats.armor).toBe(1);

    applyUpgrade(run, 'multicore');
    expect(run.stats.projectileBonus).toBe(1);

    const cooldownBefore = run.stats.cooldownMult;
    applyUpgrade(run, 'parallel');
    expect(run.stats.cooldownMult).toBeCloseTo(cooldownBefore * 0.9);

    const pickupBefore = run.stats.pickupRadius;
    applyUpgrade(run, 'gc');
    expect(run.stats.pickupRadius).toBeCloseTo(pickupBefore * 1.3);

    applyUpgrade(run, 'quantum');
    expect(run.stats.splitChance).toBeCloseTo(0.15);
  });

  it('extends max hp and heals on memory upgrade', () => {
    const run = createRun();
    run.hp = 40;
    applyUpgrade(run, 'memory');
    expect(run.stats.maxHp).toBe(120);
    expect(run.hp).toBe(60);
  });

  it('never heals above the cap', () => {
    const run = createRun();
    applyUpgrade(run, 'memory');
    expect(run.hp).toBe(run.stats.maxHp);
  });
});

describe('toCard', () => {
  it('describes a brand new weapon as NEW', () => {
    const run = createRun();
    const card = toCard(run, 'bomb');
    expect(card.isNew).toBe(true);
    expect(card.level).toBe(0);
    expect(card.nextLevel).toBe(1);
    expect(card.desc.length).toBeGreaterThan(0);
  });

  it('describes an upgrade for an owned weapon', () => {
    const run = createRun();
    run.weapons.ray = 3;
    const card = toCard(run, 'ray');
    expect(card.isNew).toBe(false);
    expect(card.level).toBe(3);
    expect(card.nextLevel).toBe(4);
  });
});
