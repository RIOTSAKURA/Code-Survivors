import { describe, expect, it } from 'vitest';
import { BOSS, ORB, PLAYER, SPAWN, THROWER } from '../src/config';
import {
  ENEMY_DEFS,
  SPAWN_POOL,
  enemyHpScale,
  enemySpeedScale,
  pickEnemyType,
  raceSprintFactor,
  spawnRamp,
  spawnRate,
} from '../src/data/enemies';
import { PASSIVE_DEFS, PASSIVE_IDS } from '../src/data/passives';
import { createRun } from '../src/core/state';
import { applyUpgrade } from '../src/systems/progression';
import {
  WEAPON_DEFS,
  WEAPON_IDS,
  bombCount,
  coneAngle,
  dartCount,
  dartDamage,
  orbitCount,
  ringSlotAngles,
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

describe('weapon ring layout (paren shield, recursive clone)', () => {
  it('spaces orbiters evenly on the circle for every count', () => {
    for (let count = 1; count <= 6; count++) {
      for (const phase of [0, 0.37, 1.9, 5.9, 12.4]) {
        const angles = ringSlotAngles(count, phase);
        expect(angles).toHaveLength(count);
        const gaps = angles.map((a, i) => {
          const next = angles[(i + 1) % count];
          let gap = next - a;
          while (gap <= 0) gap += Math.PI * 2;
          return gap;
        });
        for (const gap of gaps) expect(gap).toBeCloseTo((Math.PI * 2) / count, 9);
      }
    }
  });

  it('never stacks two orbiters on the same spot', () => {
    for (let count = 2; count <= 6; count++) {
      const angles = ringSlotAngles(count, 2.2);
      const mod = angles.map((a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
      expect(new Set(mod.map((m) => m.toFixed(6))).size).toBe(count);
    }
  });

  it('keeps the clone ring even when the squad grows mid run', () => {
    for (let count = 1; count <= 4; count++) {
      const angles = ringSlotAngles(count, 0.42);
      const gaps = angles.map((a, i) => {
        let gap = angles[(i + 1) % count] - a;
        while (gap <= 0) gap += Math.PI * 2;
        return gap;
      });
      for (const gap of gaps) expect(gap).toBeCloseTo((Math.PI * 2) / count, 9);
    }
  });

  it('keeps the layout correct when the count grows mid run', () => {
    const grown = [1, 2, 3, 4, 5, 6].map((c) => ringSlotAngles(c, 1.1));
    for (const angles of grown) {
      const count = angles.length;
      const gaps = angles.map((a, i) => {
        let gap = angles[(i + 1) % count] - a;
        while (gap <= 0) gap += Math.PI * 2;
        return gap;
      });
      for (const gap of gaps) expect(gap).toBeCloseTo((Math.PI * 2) / count, 9);
    }
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
    expect(spawnRate(0)).toBeLessThan(3);
    expect(spawnRate(1800)).toBe(SPAWN.rateMax);
    expect(spawnRate(60)).toBeLessThan(spawnRate(300));
    expect(SPAWN.maxEnemies).toBeGreaterThan(100);
  });

  it('eases the opening hardest and settles at a gentler long run ceiling', () => {
    const unclamped = (t: number) => SPAWN.rateBase + t * SPAWN.rateGrowth;
    const at = (t: number) => spawnRate(t) / unclamped(t);
    expect(spawnRate(0)).toBeLessThan(unclamped(0) * 0.7);
    expect(spawnRate(0)).toBeLessThan(1.2);
    expect(spawnRate(30)).toBeLessThan(unclamped(30) * 0.8);
    expect(spawnRate(60)).toBeLessThan(unclamped(60));
    expect(at(200)).toBeCloseTo(SPAWN.rateRampCeil, 6);
    expect(at(300)).toBeCloseTo(SPAWN.rateRampCeil, 6);
    expect(at(500)).toBeCloseTo(SPAWN.rateRampCeil, 6);
    expect(at(0)).toBeCloseTo(SPAWN.rateRampFloor, 6);
    expect(at(0)).toBeLessThan(at(60));
    expect(at(60)).toBeLessThan(at(150));
    expect(at(150)).toBeLessThan(at(200));
  });

  it('keeps the long run cut modest, never a flat global nerf', () => {
    expect(SPAWN.rateRampCeil).toBeGreaterThan(0.8);
    expect(SPAWN.rateRampCeil).toBeLessThanOrEqual(0.9);
    expect(SPAWN.rateRampFloor).toBeLessThan(SPAWN.rateRampCeil);
    for (const t of [200, 400, 800]) {
      expect(spawnRamp(t)).toBeCloseTo(SPAWN.rateRampCeil, 6);
    }
  });

  it('eases in smoothly, with no step in the slope', () => {
    let previous = spawnRate(2) - spawnRate(0);
    for (let t = 4; t <= SPAWN.rateRampTime + 20; t += 2) {
      const step = spawnRate(t) - spawnRate(t - 2);
      expect(Math.abs(step - previous)).toBeLessThan(0.02);
      previous = step;
    }
  });

  it('keeps the stretch after the first boss throttled too', () => {
    expect(spawnRamp(60)).toBeLessThan(0.8);
    expect(spawnRamp(SPAWN.bossFirstAt)).toBeLessThan(0.8);
    expect(spawnRamp(150)).toBeLessThan(SPAWN.rateRampCeil);
    expect(spawnRamp(150)).toBeGreaterThan(SPAWN.rateRampFloor);
    expect(spawnRamp(SPAWN.rateRampTime)).toBeCloseTo(SPAWN.rateRampCeil, 6);
    expect(spawnRamp(600)).toBeCloseTo(SPAWN.rateRampCeil, 6);
  });

  it('never decreases the pressure as a run goes on', () => {
    let previous = 0;
    for (let t = 0; t <= 600; t += 5) {
      const rate = spawnRate(t);
      expect(rate).toBeGreaterThanOrEqual(previous);
      previous = rate;
    }
  });

  it('gives the player time to react before the first enemy can touch them', () => {
    const travel = (600 - SPAWN.ringPadding) / 88;
    expect(travel).toBeGreaterThan(4);
    expect(travel).toBeLessThan(8);
  });
});

describe('dropped loot', () => {
  it('expires unpicked loot but warns before doing so', () => {
    expect(ORB.lifetime).toBeGreaterThan(10);
    expect(ORB.blinkTime).toBeGreaterThan(0);
    expect(ORB.blinkTime).toBeLessThan(ORB.lifetime);
    expect(ORB.bigLifetime).toBeGreaterThan(ORB.lifetime);
  });

  it('keeps rare orbs rare but worth grabbing', () => {
    expect(ORB.rareChance).toBeGreaterThan(0);
    expect(ORB.rareChance).toBeLessThan(0.05);
    expect(ORB.rareMultiplier).toBeGreaterThan(1);
  });

  it('pays a boss a lot without handing over several free levels', () => {
    const bossReward = ENEMY_DEFS.boss.xp * SPAWN.xpValueScale;
    const normalKills = bossReward / (2.86);
    expect(bossReward).toBeGreaterThan(200);
    expect(bossReward).toBeLessThan(500);
    expect(normalKills).toBeLessThan(140);
  });
});

describe('throw exception (ranged bug)', () => {
  it('joins the normal spawn pool in the early-mid game', () => {
    expect(SPAWN_POOL).toContain('thrower');
    expect(ENEMY_DEFS.thrower.unlockAt).toBeLessThanOrEqual(60);
    const seen = new Set<string>();
    for (let t = 40; t <= 140; t += 5) {
      for (let i = 0; i < 40; i++) seen.add(pickEnemyType(t, i / 40));
    }
    expect(seen.has('thrower')).toBe(true);
  });

  it('never appears before it unlocks', () => {
    for (let t = 0; t < ENEMY_DEFS.thrower.unlockAt; t += 3) {
      for (let i = 0; i < 30; i++) expect(pickEnemyType(t, i / 30)).not.toBe('thrower');
    }
  });

  it('stays a small slice of the swarm so melee plus barrage is survivable', () => {
    for (const t of [40, 60, 120, 240, 360]) {
      const total = SPAWN_POOL.reduce((sum, id) => sum + ENEMY_DEFS[id].weight(t), 0);
      const share = ENEMY_DEFS.thrower.weight(t) / total;
      expect(share).toBeGreaterThan(0.01);
      expect(share).toBeLessThan(0.06);
    }
  });

  it('holds a firing distance the player weapons can still reach', () => {
    expect(THROWER.holdDistance).toBeGreaterThan(THROWER.retreatDistance);
    expect(THROWER.holdDistance).toBeLessThanOrEqual(SPAWN.engageRange);
    expect(THROWER.range).toBeGreaterThan(THROWER.holdDistance);
    const volleyDps = (THROWER.bullets * THROWER.damage) / THROWER.castEvery;
    expect(volleyDps).toBeLessThan(PLAYER.maxHp / 4);
  });
});

describe('codex data', () => {
  it('describes every weapon, enemy and passive for the in-game codex', () => {
    for (const id of WEAPON_IDS) {
      const def = WEAPON_DEFS[id];
      expect(def.desc.length).toBeGreaterThan(4);
      expect(def.symbol.length).toBeGreaterThan(0);
      expect(def.tagline.length).toBeGreaterThan(0);
    }
    for (const id of [...SPAWN_POOL, 'boss'] as const) {
      const def = ENEMY_DEFS[id];
      expect(def.desc.length).toBeGreaterThan(4);
      expect(def.glyph.length).toBeGreaterThan(0);
    }
    for (const id of PASSIVE_IDS) {
      const def = PASSIVE_DEFS[id];
      expect(def.desc.length).toBeGreaterThan(4);
      expect(def.note.length).toBeGreaterThan(4);
    }
  });
});

describe('boss minion waves', () => {
  it('never summons the weakest bug, only sturdier kinds', () => {
    for (const pool of [BOSS.summon.pool2, BOSS.summon.pool3]) {
      expect(pool).not.toContain('syntax');
      expect(pool.length).toBeGreaterThan(0);
      for (const id of pool) {
        expect(ENEMY_DEFS[id].hp).toBeGreaterThan(ENEMY_DEFS.syntax.hp);
        expect(ENEMY_DEFS[id].damage).toBeGreaterThanOrEqual(ENEMY_DEFS.syntax.damage);
      }
    }
  });

  it('opens phase 2 with a bigger wave than the steady cycle', () => {
    const opener = BOSS.summon.openerVolleys * BOSS.summon.openerPerVolley;
    const cycle = BOSS.summon.volleys * BOSS.summon.perVolley;
    expect(opener).toBeGreaterThanOrEqual(cycle);
    expect(opener).toBeGreaterThanOrEqual(15);
  });

  it('sends the toughest bugs only once the boss is nearly dead', () => {
    expect(BOSS.summon.pool2).not.toContain('stack');
    expect(BOSS.summon.pool3).toContain('stack');
  });
});

describe('passive isolation', () => {
  it('never lets the player speed passive leak into enemy stats', () => {
    const ids = [...SPAWN_POOL, 'boss'] as const;
    const enemySpeeds = ids.map((id) => ENEMY_DEFS[id].speed);
    const enemyHp = ids.map((id) => ENEMY_DEFS[id].hp);
    const run = createRun();
    for (const id of PASSIVE_IDS) {
      for (let level = 0; level < 6; level++) applyUpgrade(run, id);
    }
    expect(run.stats.speed).toBeCloseTo(200 * Math.pow(1.15, 5), 6);
    expect(ENEMY_DEFS.syntax.speed).toBe(enemySpeeds[0]);
    ids.forEach((id, i) => {
      expect(ENEMY_DEFS[id].speed).toBe(enemySpeeds[i]);
      expect(ENEMY_DEFS[id].hp).toBe(enemyHp[i]);
    });
  });

  it('keeps the race condition the fastest bug but still outrunnable', () => {
    const racer = ENEMY_DEFS.race.speed;
    for (const id of SPAWN_POOL) {
      if (id === 'race') continue;
      expect(racer).toBeGreaterThan(ENEMY_DEFS[id].speed);
    }
    const sprint = racer * raceSprintFactor(600) * enemySpeedScale(300);
    expect(sprint).toBeLessThan(PLAYER.speed);
  });

  it('sprints harder the further away the target is, capped at +25%', () => {
    expect(raceSprintFactor(0)).toBe(1);
    expect(raceSprintFactor(200)).toBeCloseTo(1.125, 6);
    expect(raceSprintFactor(400)).toBeCloseTo(1.25, 6);
    expect(raceSprintFactor(5000)).toBeCloseTo(1.25, 6);
    expect(raceSprintFactor(120)).toBeLessThan(raceSprintFactor(300));
  });

  it('scales enemy speed with the run clock only', () => {
    const scaleAt = (seconds: number) => enemySpeedScale(seconds);
    expect(scaleAt(0)).toBe(1);
    expect(scaleAt(60)).toBeGreaterThan(1);
    expect(scaleAt(60)).toBeCloseTo(scaleAt(60), 12);
    expect(enemySpeedScale(600) / enemySpeedScale(300)).toBeCloseTo(
      (1 + 10 * SPAWN.speedScalePerMin) / (1 + 5 * SPAWN.speedScalePerMin),
      12,
    );
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
