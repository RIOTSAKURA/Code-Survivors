import { describe, expect, it } from 'vitest';
import { SPAWN } from '../src/config';
import { ENEMY_DEFS, SPAWN_POOL, enemyHpScale, enemySpeedScale, pickEnemyType } from '../src/data/enemies';
import { PASSIVE_IDS } from '../src/data/passives';
import {
  WEAPON_DEFS,
  WEAPON_IDS,
  bombCount,
  coneAngle,
  dartCount,
  dartDamage,
  orbitCount,
  rayCount,
} from '../src/data/weapons';

describe('weapon scaling', () => {
  it('keeps timer driven cooldowns positive and fast at max level', () => {
    for (const id of WEAPON_IDS) {
      for (let level = 1; level <= WEAPON_DEFS[id].maxLevel; level++) {
        const cooldown = WEAPON_DEFS[id].cooldown(level);
        expect(cooldown).toBeGreaterThanOrEqual(0);
        if (id === 'dart' || id === 'bomb' || id === 'ray' || id === 'cone') {
          expect(cooldown).toBeGreaterThan(0.15);
        }
      }
    }
  });

  it('never decreases damage as level rises', () => {
    expect(dartDamage(4)).toBeGreaterThan(dartDamage(1));
    for (let level = 2; level <= 8; level++) {
      expect(dartDamage(level)).toBeGreaterThanOrEqual(dartDamage(level - 1));
    }
  });

  it('adds projectiles with level', () => {
    expect(dartCount(6)).toBeGreaterThan(dartCount(1));
    expect(orbitCount(8)).toBeGreaterThan(orbitCount(1));
    expect(bombCount(8)).toBeGreaterThanOrEqual(bombCount(1));
    expect(rayCount(8)).toBeGreaterThan(rayCount(1));
    expect(coneAngle(8)).toBeGreaterThan(coneAngle(1));
  });

  it('caps multi-projectile weapons to a sane count', () => {
    expect(orbitCount(8)).toBeLessThanOrEqual(6);
    expect(dartCount(8)).toBeLessThanOrEqual(4);
    expect(bombCount(8)).toBeLessThanOrEqual(4);
  });
});

describe('enemy scaling', () => {
  it('only spawns syntax bugs at the very start', () => {
    for (let i = 0; i < 50; i++) {
      expect(pickEnemyType(0, i / 50)).toBe('syntax');
    }
  });

  it('unlocks more types over time', () => {
    const seen = new Set<string>();
    for (let t = 0; t < 400; t += 5) {
      for (let i = 0; i < 40; i++) seen.add(pickEnemyType(t, i / 40));
    }
    for (const id of SPAWN_POOL) expect(seen.has(id)).toBe(true);
    expect(seen.has('boss')).toBe(false);
  });

  it('never returns a locked type', () => {
    for (let t = 0; t < 240; t += 3) {
      for (let i = 0; i < 30; i++) {
        const id = pickEnemyType(t, i / 30);
        expect(ENEMY_DEFS[id].unlockAt).toBeLessThanOrEqual(t);
      }
    }
  });

  it('raises hp and speed over time', () => {
    expect(enemyHpScale(300, 1)).toBeGreaterThan(enemyHpScale(0, 1));
    expect(enemyHpScale(0, 20)).toBeGreaterThan(enemyHpScale(0, 1));
    expect(enemySpeedScale(600)).toBeGreaterThan(enemySpeedScale(0));
  });

  it('is survivable at minute one with a level 1 dart', () => {
    const hp = ENEMY_DEFS.syntax.hp * enemyHpScale(60, 3);
    const dartDps = dartDamage(1) / WEAPON_DEFS.dart.cooldown(1);
    expect(hp / dartDps).toBeLessThan(2.5);
  });

  it('ramps pressure without exploding', () => {
    const rate = (t: number) => Math.min(SPAWN.rateMax, SPAWN.rateBase + t * SPAWN.rateGrowth);
    expect(rate(0)).toBeLessThan(3);
    expect(rate(1800)).toBe(SPAWN.rateMax);
    expect(rate(60)).toBeLessThan(rate(300));
    expect(SPAWN.maxEnemies).toBeGreaterThan(100);
  });

  it('gives the player time to react before the first enemy can touch them', () => {
    const travel = (600 - SPAWN.ringPadding) / 88;
    expect(travel).toBeGreaterThan(4);
    expect(travel).toBeLessThan(8);
  });
});

describe('passives', () => {
  it('ships all eight documented passives', () => {
    expect(PASSIVE_IDS).toHaveLength(8);
    expect(new Set(PASSIVE_IDS).size).toBe(8);
  });

  it('ships all six documented weapons', () => {
    expect(WEAPON_IDS).toHaveLength(6);
    expect(new Set(WEAPON_IDS).size).toBe(6);
  });
});
