import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { createRun } from '../src/core/state';
import { PASSIVE_DEFS, PASSIVE_IDS } from '../src/data/passives';
import { WEAPON_DEFS, WEAPON_IDS } from '../src/data/weapons';
import { hud, syncHud } from '../src/core/state';
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

  it('keeps the early game deliberately slow', () => {
    let early = 0;
    for (let level = 1; level <= 5; level++) early += xpForLevel(level);
    expect(early).toBeGreaterThanOrEqual(100);
    expect(early).toBeLessThanOrEqual(140);
  });

  it('ramps the cost hard in the late game so levels stop flying by', () => {
    expect(xpForLevel(40) / xpForLevel(10)).toBeGreaterThan(6);
    expect(xpForLevel(30) / xpForLevel(15)).toBeGreaterThan(2.5);
    expect(xpForLevel(50)).toBeGreaterThan(700);
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

  it('honours the configured weapon slot count', () => {
    const run = createRun(4);
    for (const id of ['dart', 'orbit', 'bomb', 'ray'] as const) run.weapons[id] = 1;
    const choices = pickChoices(run, new Rng(13), 12);
    for (const id of choices) {
      if (!WEAPON_IDS.includes(id as never)) continue;
      expect(run.weapons[id as 'dart'] ?? 0).toBeGreaterThan(0);
    }
    expect(run.rerolls).toBe(2);
    expect(run.skips).toBe(2);
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

  it('applies the flat stat passives', () => {
    const run = createRun();
    const baseSpeed = run.stats.speed;
    applyUpgrade(run, 'compile');
    expect(run.stats.speed).toBeCloseTo(baseSpeed * 1.15);

    applyUpgrade(run, 'multicore');
    expect(run.stats.projectileBonus).toBe(1);

    applyUpgrade(run, 'quantum');
    expect(run.stats.splitChance).toBeCloseTo(0.15);
  });

  it('leaves the conditional passives to the scene instead of changing flat stats', () => {
    const run = createRun();
    const cooldown = run.stats.cooldownMult;
    const pickup = run.stats.pickupRadius;
    for (const id of ['cache', 'parallel', 'gc', 'typesafe'] as const) {
      applyUpgrade(run, id);
      expect(run.passives[id]).toBe(1);
    }
    expect(run.stats.cooldownMult).toBe(cooldown);
    expect(run.stats.pickupRadius).toBe(pickup);
    expect(run.stats.armor).toBe(0);
  });

  it('extends max hp and heals exactly 20 from any hp state', () => {
    for (const start of [100, 90, 55, 20, 1]) {
      const run = createRun();
      run.hp = start;
      applyUpgrade(run, 'memory');
      expect(run.stats.maxHp).toBe(120);
      expect(run.hp).toBe(Math.min(120, start + 20));
    }
  });

  it('never heals above the cap', () => {
    const run = createRun();
    applyUpgrade(run, 'memory');
    expect(run.hp).toBe(run.stats.maxHp);
  });

  it('stacks the heal across all five levels', () => {
    const run = createRun();
    run.hp = 10;
    for (let i = 0; i < 5; i++) applyUpgrade(run, 'memory');
    expect(run.stats.maxHp).toBe(200);
    expect(run.hp).toBe(110);
    const overflow = createRun();
    for (let i = 0; i < 5; i++) applyUpgrade(overflow, 'memory');
    expect(overflow.hp).toBe(200);
  });

  it('publishes the new cap to the hud', () => {
    const run = createRun();
    run.hp = 30;
    applyUpgrade(run, 'memory');
    syncHud(run, 10);
    expect(hud.maxHp).toBe(120);
    expect(hud.hp).toBe(50);
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

  it('shows synergy with the current build on cards', () => {
    const run = createRun();
    run.weapons.dart = 1;
    run.weapons.bomb = 1;
    run.passives.parallel = 2;
    expect(toCard(run, 'parallel').synergy).toContain('2 把武器');
    expect(toCard(run, 'ray').synergy).toContain('并行');
    run.evolutions.dart = 'dart_stack';
    expect(toCard(run, 'cache').synergy).toContain('集火');
    expect(toCard(run, 'multicore').synergy).toContain('集火');
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
