import { PALETTE } from '../config';
import type { WeaponId } from '../core/types';

const TAU_LOCAL = Math.PI * 2;

export interface WeaponDef {
  id: WeaponId;
  name: string;
  symbol: string;
  tagline: string;
  desc: string;
  color: number;
  maxLevel: number;
  cooldown: (level: number) => number;
  detail: (level: number) => string;
  note: (level: number) => string;
}

function round(n: number, digits = 0): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export const dartCount = (l: number): number => 1 + Math.floor((l - 1) / 2);
export const dartDamage = (l: number): number => 11 + 3 * (l - 1);
export const dartSpeed = (l: number): number => 600 + 24 * (l - 1);
export const dartPierce = (l: number): number => (l >= 7 ? 1 : 0);

export const orbitCount = (l: number): number => 1 + Math.ceil(l / 2);
export const orbitSpin = (l: number): number => 2.5 + l * 0.12;
export const CLONE_SPIN = 0.9;
export const CLONE_DISTANCE = 76;
export const ringSlotAngles = (count: number, phase: number): number[] => {
  const angles: number[] = [];
  for (let slot = 0; slot < count; slot++) angles.push(phase + (slot / count) * TAU_LOCAL);
  return angles;
};
export const orbitDamage = (l: number): number => 7 + 3 * (l - 1);
export const orbitRadius = (l: number): number => 76 + 7 * (l - 1);

export const bombCount = (l: number): number => 1 + Math.floor(l / 3);
export const bombDamage = (l: number): number => 24 + 9 * (l - 1);
export const bombBlast = (l: number): number => 92 + 10 * (l - 1);

export const rayCount = (l: number): number => 1 + Math.floor((l - 1) / 3);
export const rayDamage = (l: number): number => 16 + 6 * (l - 1);
export const rayWidth = (l: number): number => 26 + 4 * (l - 1);

export const coneDamage = (l: number): number => 13 + 5 * (l - 1);
export const coneAngle = (l: number): number => 70 + 9 * (l - 1);
export const coneRange = (l: number): number => 150 + 12 * (l - 1);

export const cloneCount = (l: number): number => 1 + Math.floor((l - 1) / 2);
export const cloneDamage = (l: number): number => 6 + 2.5 * (l - 1);
export const cloneCooldown = (l: number): number => 1.5 - 0.06 * (l - 1);

export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = {
  dart: {
    id: 'dart',
    name: '分号飞镖',
    symbol: ';',
    tagline: 'Semicolon Dart',
    desc: '直线投射物，自动瞄准最近敌人',
    color: PALETTE.cyan,
    maxLevel: 8,
    cooldown: (l) => 0.95 - 0.06 * (l - 1),
    detail: (l) =>
      `飞镖 ${dartCount(l)} · 伤害 ${round(dartDamage(l))} · 穿透 ${dartPierce(l)}`,
    note: (l) => `飞镖 ${dartCount(l)}→${dartCount(l + 1)} · 伤害 +3`,
  },
  orbit: {
    id: 'orbit',
    name: '括号护盾',
    symbol: '()',
    tagline: 'Paren Shield',
    desc: '括号环绕本体旋转，接触造成伤害与击退',
    color: PALETTE.blue,
    maxLevel: 8,
    cooldown: () => 0.28,
    detail: (l) =>
      `环绕 ${orbitCount(l)} · 伤害 ${round(orbitDamage(l))} · 半径 ${round(orbitRadius(l))}`,
    note: (l) => `环绕 ${orbitCount(l)}→${orbitCount(l + 1)} · 伤害 +3`,
  },
  bomb: {
    id: 'bomb',
    name: '感叹号炸弹',
    symbol: '!',
    tagline: 'Bang Bomb',
    desc: '抛物线炸弹，落点范围爆炸（伤害随距离衰减）',
    color: PALETTE.orange,
    maxLevel: 8,
    cooldown: (l) => 2.6 - 0.16 * (l - 1),
    detail: (l) => `炸弹 ${bombCount(l)} · 爆炸 ${round(bombBlast(l))} · 伤害 ${round(bombDamage(l))}`,
    note: (l) => `伤害 ${round(bombDamage(l))}→${round(bombDamage(l + 1))} · 半径 +10`,
  },
  ray: {
    id: 'ray',
    name: '正则射线',
    symbol: '/regex/',
    tagline: 'Regex Ray',
    desc: '全穿透激光，一条线上所有敌人一起吃伤害',
    color: PALETTE.green,
    maxLevel: 8,
    cooldown: (l) => 1.8 - 0.1 * (l - 1),
    detail: (l) => `射线 ${rayCount(l)} · 伤害 ${round(rayDamage(l))} · 宽度 ${round(rayWidth(l))}`,
    note: (l) => `伤害 +6 · 宽度 +4 · 射线 ${rayCount(l)}→${rayCount(l + 1)}`,
  },
  cone: {
    id: 'cone',
    name: '注释屏障',
    symbol: '//',
    tagline: 'Comment Barrier',
    desc: '前方扇形 AOE，一次清掉贴脸的一整片怪',
    color: PALETTE.textDim,
    maxLevel: 8,
    cooldown: (l) => 1.5 - 0.08 * (l - 1),
    detail: (l) =>
      `扇形 ${round(coneAngle(l))}° · 距离 ${round(coneRange(l))} · 伤害 ${round(coneDamage(l))}`,
    note: (l) => `角度 ${round(coneAngle(l))}°→${round(coneAngle(l + 1))}° · 伤害 +5`,
  },
  clone: {
    id: 'clone',
    name: '递归克隆',
    symbol: 'fn()',
    tagline: 'Recursive Clone',
    desc: '召唤环绕分身，自动向附近敌人射击',
    color: PALETTE.purple,
    maxLevel: 8,
    cooldown: () => 0,
    detail: (l) => `分身 ${cloneCount(l)} · 伤害 ${round(cloneDamage(l))}`,
    note: (l) => `分身 ${cloneCount(l)}→${cloneCount(l + 1)} · 伤害 +2.5`,
  },
};

export const WEAPON_IDS: WeaponId[] = ['dart', 'orbit', 'bomb', 'ray', 'cone', 'clone'];
