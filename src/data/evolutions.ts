import { PALETTE } from '../config';
import type { EvolutionId, RunState, WeaponId } from '../core/types';

export const EVOLUTION_LEVEL = 5;
export const EVOLUTION_WEAPONS: WeaponId[] = ['dart', 'orbit', 'bomb', 'clone'];

export const DART_BOUNCE = { radius: 280, scale: 0.65, bounces: 1 };
export const DART_FOCUS = { perHit: 0.12, maxStacks: 6, window: 2.5 };
export const ORBIT_WIDE = { radius: 1.35, knockback: 2.4 };
export const ORBIT_REFLECT = { radius: 0.72, reflectRadius: 46, damageScale: 2.4, speedScale: 1.55 };
export const BOMB_BURN = { duration: 3.2, tick: 0.5, dpsScale: 0.3, radiusScale: 0.85 };
export const BOMB_CHAIN = {
  fuseBonus: 0.35,
  delay: 0.22,
  radiusScale: 0.8,
  damageScale: 0.7,
  searchRadius: 260,
  count: 2,
  depth: 2,
};
export const CLONE_FOCUS = { rangeScale: 1.2 };
export const CLONE_SPREAD = { rangeScale: 1.15 };

export interface EvolutionDef {
  id: EvolutionId;
  weapon: WeaponId;
  branch: 'A' | 'B';
  name: string;
  symbol: string;
  tagline: string;
  desc: string;
  color: number;
}

export const EVOLUTION_DEFS: Record<EvolutionId, EvolutionDef> = {
  dart_bounce: {
    id: 'dart_bounce',
    weapon: 'dart',
    branch: 'A',
    name: '弹射飞镖',
    symbol: ';>>',
    tagline: 'Ricochet',
    desc: '飞镖命中后弹向附近另一个目标，弹射伤害 ×65%，适合清群',
    color: PALETTE.cyan,
  },
  dart_stack: {
    id: 'dart_stack',
    weapon: 'dart',
    branch: 'B',
    name: '聚焦飞镖',
    symbol: ';+',
    tagline: 'Focus Stack',
    desc: '连续命中同一目标每次 +12% 伤害，最多 6 层；切换目标或目标死亡后清零',
    color: PALETTE.blue,
  },
  orbit_wide: {
    id: 'orbit_wide',
    weapon: 'orbit',
    branch: 'A',
    name: '广域护盾',
    symbol: '()>',
    tagline: 'Wide Orbit',
    desc: '环绕半径 ×1.35、击退 ×2.4，把贴近的虫群整片推开',
    color: PALETTE.blue,
  },
  orbit_reflect: {
    id: 'orbit_reflect',
    weapon: 'orbit',
    branch: 'B',
    name: '反射护盾',
    symbol: '()<',
    tagline: 'Reflect Core',
    desc: '环绕半径 ×0.72，但反弹弹伤害 ×2.4、弹速 ×1.55，反弹范围也更大',
    color: PALETTE.cyan,
  },
  bomb_burn: {
    id: 'bomb_burn',
    weapon: 'bomb',
    branch: 'A',
    name: '燃烧炸弹',
    symbol: '!~',
    tagline: 'Incendiary',
    desc: '爆炸后留下持续 3.2s 的燃烧区，每 0.5s 对圈内敌人造成伤害，适合封路清群',
    color: PALETTE.orange,
  },
  bomb_chain: {
    id: 'bomb_chain',
    weapon: 'bomb',
    branch: 'B',
    name: '连锁炸弹',
    symbol: '!>',
    tagline: 'Chain Reaction',
    desc: '落点延迟 0.35s 爆炸，并在附近敌人处引发二次爆炸，最多连锁 2 层',
    color: PALETTE.yellow,
  },
  clone_focus: {
    id: 'clone_focus',
    weapon: 'clone',
    branch: 'A',
    name: '集火克隆',
    symbol: 'fn>',
    tagline: 'Focus Fire',
    desc: '所有分身锁定同一目标，射程略微增加，适合快速处理 Boss 与精英',
    color: PALETTE.purple,
  },
  clone_spread: {
    id: 'clone_spread',
    weapon: 'clone',
    branch: 'B',
    name: '散射克隆',
    symbol: 'fn*',
    tagline: 'Spread Fire',
    desc: '分身各自锁定不同目标，尽量覆盖更多方向，避免火力重叠',
    color: PALETTE.white,
  },
};

export function isEvolutionWeapon(id: string): id is WeaponId {
  return EVOLUTION_WEAPONS.includes(id as WeaponId);
}

export function evolutionsFor(weapon: WeaponId): EvolutionId[] {
  return EVOLUTION_WEAPONS.includes(weapon)
    ? (Object.values(EVOLUTION_DEFS)
        .filter((def) => def.weapon === weapon)
        .sort((a, b) => a.branch.localeCompare(b.branch))
        .map((def) => def.id))
    : [];
}

export function evolutionCandidates(run: RunState, pending: WeaponId[] = []): WeaponId[] {
  return EVOLUTION_WEAPONS.filter(
    (weapon) =>
      (run.weapons[weapon] ?? 0) > 0 && !run.evolutions[weapon] && !pending.includes(weapon),
  );
}
