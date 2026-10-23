import { PALETTE, SPAWN } from '../config';
import type { EnemyTypeId } from '../core/types';

export interface EnemyDef {
  id: EnemyTypeId;
  name: string;
  glyph: string;
  label: string;
  color: number;
  scale: number;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  xp: number;
  unlockAt: number;
  weight: (time: number) => number;
  phasing: boolean;
}

export const ENEMY_DEFS: Record<EnemyTypeId, EnemyDef> = {
  syntax: {
    id: 'syntax',
    name: 'Syntax Bug',
    glyph: '~',
    label: 'syntax',
    color: PALETTE.red,
    scale: 26,
    hp: 7,
    speed: 88,
    damage: 5,
    radius: 13,
    xp: 1,
    unlockAt: 0,
    weight: () => 10,
    phasing: false,
  },
  nullptr: {
    id: 'nullptr',
    name: 'Null Pointer',
    glyph: 'null',
    label: 'null',
    color: PALETTE.textDim,
    scale: 24,
    hp: 22,
    speed: 62,
    damage: 8,
    radius: 15,
    xp: 2,
    unlockAt: 25,
    weight: (t) => (t > 45 ? 6 : t > 25 ? 3 : 0),
    phasing: true,
  },
  memleak: {
    id: 'memleak',
    name: 'Memory Leak',
    glyph: '[]',
    label: 'leak',
    color: PALETTE.green,
    scale: 28,
    hp: 46,
    speed: 46,
    damage: 14,
    radius: 16,
    xp: 3,
    unlockAt: 60,
    weight: (t) => (t > 100 ? 5 : t > 60 ? 3 : 0),
    phasing: false,
  },
  race: {
    id: 'race',
    name: 'Race Condition',
    glyph: '<<',
    label: 'race',
    color: PALETTE.purple,
    scale: 26,
    hp: 18,
    speed: 128,
    damage: 11,
    radius: 13,
    xp: 2,
    unlockAt: 85,
    weight: (t) => (t > 130 ? 6 : t > 85 ? 3 : 0),
    phasing: false,
  },
  stack: {
    id: 'stack',
    name: 'Stack Overflow',
    glyph: '{}',
    label: 'stack',
    color: 0xd9483a,
    scale: 40,
    hp: 210,
    speed: 34,
    damage: 18,
    radius: 26,
    xp: 6,
    unlockAt: 110,
    weight: (t) => (t > 150 ? 4 : t > 110 ? 2 : 0),
    phasing: false,
  },
  boss: {
    id: 'boss',
    name: 'Segfault',
    glyph: '0xDEAD',
    label: 'SEGFAULT',
    color: 0xff2d55,
    scale: 64,
    hp: 900,
    speed: 40,
    damage: 20,
    radius: 52,
    xp: 132,
    unlockAt: Number.POSITIVE_INFINITY,
    weight: () => 0,
    phasing: false,
  },
};

export const SPAWN_POOL: EnemyTypeId[] = ['syntax', 'nullptr', 'memleak', 'race', 'stack'];

export function enemyHpScale(time: number, playerLevel: number): number {
  const minutes = time / 60;
  return (
    1 + minutes * SPAWN.hpScalePerMin + Math.max(0, playerLevel - 1) * SPAWN.hpScalePerLevel
  );
}

export function raceSprintFactor(dist: number): number {
  return 1 + 0.25 * Math.min(dist / 400, 1);
}

export function enemySpeedScale(time: number): number {
  return 1 + (time / 60) * SPAWN.speedScalePerMin;
}

export function pickEnemyType(time: number, roll: number): EnemyTypeId {
  const pool = SPAWN_POOL.filter((id) => time >= ENEMY_DEFS[id].unlockAt);
  const weights = pool.map((id) => ENEMY_DEFS[id].weight(time));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 'syntax';
  let acc = roll * total;
  for (let i = 0; i < pool.length; i++) {
    acc -= weights[i];
    if (acc <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
