import { BOSS, PALETTE, SPAWN } from '../config';
import type { EnemyTypeId } from '../core/types';

export interface EnemyDef {
  id: EnemyTypeId;
  name: string;
  glyph: string;
  label: string;
  desc: string;
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
    desc: '直线追击玩家，数量最多的杂兵',
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
    desc: '无视碰撞挤位、慢速穿行，会从怪堆里钻出来',
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
    desc: '持续膨胀变大，越大越慢但接触伤害越高',
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
    desc: '冲刺追击：全场最快基础移速，距离越远冲得越快',
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
    desc: '高血量慢速重甲，撞击会产生大量击退',
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
  deadlock: {
    id: 'deadlock',
    name: 'Deadlock',
    glyph: '=X=',
    label: 'deadlock',
    desc: '成对出现：两只死锁之间会短暂形成危险连线，连线激活后穿过会受伤；优先击杀其中一只',
    color: PALETTE.cyan,
    scale: 26,
    hp: 38,
    speed: 70,
    damage: 9,
    radius: 15,
    xp: 3,
    unlockAt: 120,
    weight: (t) => (t > 180 ? 4 : 2.4),
    phasing: false,
  },
  breakpoint: {
    id: 'breakpoint',
    name: 'Breakpoint',
    glyph: '^!',
    label: 'breakpoint',
    desc: '保持距离并提前标记玩家脚下，延迟后爆炸；看到标记后立刻离开圆圈',
    color: PALETTE.orange,
    scale: 26,
    hp: 52,
    speed: 52,
    damage: 8,
    radius: 15,
    xp: 4,
    unlockAt: 145,
    weight: (t) => (t > 200 ? 3 : 2),
    phasing: false,
  },
  daemon: {
    id: 'daemon',
    name: 'Daemon',
    glyph: '&',
    label: 'daemon',
    desc: '缓慢跟随并强化附近最多 6 名敌人（移速与伤害提升）；优先击杀以解除光环',
    color: PALETTE.purple,
    scale: 30,
    hp: 95,
    speed: 40,
    damage: 10,
    radius: 18,
    xp: 6,
    unlockAt: 175,
    weight: (t) => (t > 240 ? 2.2 : 1.4),
    phasing: false,
  },
  thrower: {
    id: 'thrower',
    name: 'Throw Exception',
    glyph: 'throw',
    label: 'throw',
    desc: '保持中距离游走并向玩家抛射扇形弹幕，不会贴身缠斗；靠近时会后撤，需要优先点掉',
    color: PALETTE.yellow,
    scale: 26,
    hp: 26,
    speed: 58,
    damage: 8,
    radius: 14,
    xp: 3,
    unlockAt: 35,
    weight: () => 0.6,
    phasing: false,
  },
  boss: {
    id: 'boss',
    name: 'Segfault',
    glyph: '0xDEAD',
    label: 'SEGFAULT',
    desc: '每 115s 登场：镜头切到出场点、全场静止，并释放电磁脉冲清空地上所有经验球与普通敌人。存活期间不刷新普通敌人，只召唤不掉经验的小怪。三阶段：密集环形弹幕 → 大批小怪 + 降频弹幕 → 螺旋弹幕，击败掉落 6 个稀有球',
    color: 0xff2d55,
    scale: 64,
    hp: 2200,
    speed: 40,
    damage: 20,
    radius: 52,
    xp: 132,
    unlockAt: Number.POSITIVE_INFINITY,
    weight: () => 0,
    phasing: false,
  },
};

export const SPAWN_POOL: EnemyTypeId[] = [
  'syntax',
  'nullptr',
  'memleak',
  'race',
  'stack',
  'thrower',
  'deadlock',
  'breakpoint',
  'daemon',
];

export function bossSummonPool(time: number, phase: number): EnemyTypeId[] {
  const base = phase >= 3 ? BOSS.summon.pool3 : BOSS.summon.pool2;
  if (time >= BOSS.summon.tankAfter) return base;
  return base.filter((id) => id !== 'stack');
}

export function spawnRamp(time: number): number {
  const u = Math.min(1, Math.max(0, time / SPAWN.rateRampTime));
  const eased = u * u * (3 - 2 * u);
  return SPAWN.rateRampFloor + (SPAWN.rateRampCeil - SPAWN.rateRampFloor) * eased;
}

export function spawnRate(time: number): number {
  return Math.min(SPAWN.rateMax, (SPAWN.rateBase + time * SPAWN.rateGrowth) * spawnRamp(time));
}

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
