import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { createRun } from '../src/core/state';
import type { BossReward } from '../src/data/rewards';
import {
  RARE_MODULES,
  REPAIR_REWARD,
  availableRareModules,
  rollBossRewards,
  rollRareModule,
} from '../src/data/rewards';
import { applyBossReward } from '../src/systems/progression';

const moduleReward = (id: BossReward['id']): BossReward => ({
  id,
  name: id,
  symbol: id,
  tagline: id,
  desc: id,
  color: 0,
});

describe('boss rewards', () => {
  it('always offers three distinct choices including a repair', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const run = createRun();
      run.weapons.dart = 2;
      const rewards = rollBossRewards(run, new Rng(seed));
      expect(rewards).toHaveLength(3);
      expect(new Set(rewards.map((r) => r.id)).size).toBe(3);
      expect(rewards.some((r) => r.id === 'restore')).toBe(true);
    }
  });

  it('offers the evolution protocol for an owned, unevolved branch weapon', () => {
    const run = createRun();
    run.weapons.dart = 2;
    run.weapons.orbit = 4;
    const rewards = rollBossRewards(run, new Rng(4), []);
    const evo = rewards.find((r) => r.id === 'evolution');
    expect(evo?.evolutionWeapon).toBe('orbit');
  });

  it('does not offer an evolution that is already chosen or queued', () => {
    const run = createRun();
    run.weapons.dart = 2;
    run.weapons.orbit = 2;
    run.evolutions.dart = 'dart_bounce';
    run.evolutions.orbit = 'orbit_reflect';
    expect(rollBossRewards(run, new Rng(9), []).some((r) => r.id === 'evolution')).toBe(false);
    const queued = createRun();
    queued.weapons.dart = 2;
    const rewards = rollBossRewards(queued, new Rng(9), ['dart']);
    expect(rewards.some((r) => r.id === 'evolution')).toBe(false);
    expect(rewards.some((r) => r.id === 'weapon_level')).toBe(true);
  });

  it('turns a full loadout into a three-module choice', () => {
    const run = createRun();
    for (const id of ['dart', 'orbit', 'bomb', 'ray', 'cone', 'clone'] as const) {
      run.weapons[id] = 8;
    }
    run.evolutions.dart = 'dart_bounce';
    run.evolutions.orbit = 'orbit_reflect';
    run.evolutions.bomb = 'bomb_burn';
    run.evolutions.ray = 'ray_lock';
    run.evolutions.cone = 'cone_wall';
    run.evolutions.clone = 'clone_focus';
    const rewards = rollBossRewards(run, new Rng(3));
    expect(rewards).toHaveLength(3);
    expect(rewards.filter((r) => r.id !== 'restore')).toHaveLength(2);
    expect(rewards.some((r) => r.id === 'restore')).toBe(true);
  });

  it('rolls modules for the dangerous commit', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const reward = rollRareModule(createRun(), new Rng(seed));
      expect(reward.id.startsWith('module_')).toBe(true);
      expect(reward.name.length).toBeGreaterThan(0);
    }
  });

  it('gates rare modules behind the build that makes them useful', () => {
    const plain = createRun();
    plain.weapons.dart = 8;
    expect(availableRareModules(plain)).toHaveLength(0);

    const focus = createRun();
    focus.evolutions.dart = 'dart_stack';
    focus.passives.gc = 1;
    focus.evolutions.orbit = 'orbit_reflect';
    focus.evolutions.bomb = 'bomb_burn';
    const ids = availableRareModules(focus).map((module) => module.id);
    expect(ids).toEqual(
      expect.arrayContaining(['reflect_charge', 'gc_vulnerable', 'focus_transfer', 'burn_detonate']),
    );

    focus.rareModules.focus_transfer = 1;
    focus.rareModules.gc_vulnerable = 1;
    expect(availableRareModules(focus)).toHaveLength(0);

    focus.rareModules = {};
    const rewards = rollBossRewards(focus, new Rng(7));
    expect(rewards.some((reward) => RARE_MODULES.some((module) => module.id === reward.id))).toBe(true);
  });

  it('applies every module effect', () => {
    const damage = createRun();
    applyBossReward(damage, moduleReward('module_damage'));
    expect(damage.stats.damageMult).toBeCloseTo(1.18, 6);

    const cooldown = createRun();
    applyBossReward(cooldown, moduleReward('module_cooldown'));
    expect(cooldown.stats.cooldownMult).toBeCloseTo(0.88, 6);

    const armor = createRun();
    applyBossReward(armor, moduleReward('module_armor'));
    expect(armor.stats.armor).toBe(1);

    const speed = createRun();
    applyBossReward(speed, moduleReward('module_speed'));
    expect(speed.stats.speed).toBeCloseTo(220, 6);
  });

  it('repairs a chunk of hp and raises the cap', () => {
    const run = createRun();
    run.hp = 20;
    applyBossReward(run, REPAIR_REWARD);
    expect(run.stats.maxHp).toBe(125);
    expect(run.hp).toBe(95);
  });

  it('signals evolution and weapon-level outcomes to the scene', () => {
    const run = createRun();
    run.weapons.dart = 2;
    const evolution = applyBossReward(run, {
      ...moduleReward('evolution'),
      evolutionWeapon: 'dart',
    });
    expect(evolution.evolve).toBe('dart');
    expect(run.evolutions.dart).toBeUndefined();

    const upgrade = applyBossReward(run, {
      ...moduleReward('weapon_level'),
      upgradeWeapon: 'dart',
    });
    expect(upgrade.upgraded).toBe('dart');
    expect(run.weapons.dart).toBe(3);
  });
});
