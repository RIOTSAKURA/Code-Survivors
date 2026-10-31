import { PALETTE, RARE } from '../config';
import type { RareModuleId, RunState, WeaponId } from '../core/types';
import { evolutionCandidates } from './evolutions';
import { WEAPON_DEFS, WEAPON_IDS } from './weapons';

export type RewardId =
  | 'evolution'
  | 'weapon_level'
  | 'module_damage'
  | 'module_cooldown'
  | 'module_armor'
  | 'module_speed'
  | RareModuleId
  | 'restore';

export interface BossReward {
  id: RewardId;
  name: string;
  symbol: string;
  tagline: string;
  desc: string;
  color: number;
  evolutionWeapon?: WeaponId;
  upgradeWeapon?: WeaponId;
  rare?: boolean;
}

export interface RewardRng {
  pick<T>(items: readonly T[]): T;
}

const MODULES: BossReward[] = [
  {
    id: 'module_damage',
    name: '过载模块',
    symbol: 'dmg+',
    tagline: 'Overclock',
    desc: '所有武器伤害 +18%',
    color: PALETTE.red,
  },
  {
    id: 'module_cooldown',
    name: '并行补丁',
    symbol: 'cd-',
    tagline: 'Thread Patch',
    desc: '所有武器冷却 -12%',
    color: PALETTE.orange,
  },
  {
    id: 'module_armor',
    name: '类型守卫',
    symbol: 'T+',
    tagline: 'Type Guard',
    desc: '护甲 +1，每次受击少掉 1 点血',
    color: PALETTE.white,
  },
  {
    id: 'module_speed',
    name: 'JIT 预热',
    symbol: 'spd+',
    tagline: 'JIT Boost',
    desc: '移动速度 +10%',
    color: PALETTE.blue,
  },
];

export const RARE_MODULES: BossReward[] = [
  {
    id: 'reflect_charge',
    name: '反射充能',
    symbol: '()~',
    tagline: 'Reflect Charge',
    desc: '反射弹击杀积攒护盾充能，满后立即恢复一层类型护盾',
    color: PALETTE.cyan,
    rare: true,
  },
  {
    id: 'gc_vulnerable',
    name: '回收标记',
    symbol: '{}!',
    tagline: 'GC Mark',
    desc: `GC 清扫命中的敌人易伤 +${Math.round((RARE.gcVulnerable.mult - 1) * 100)}%，持续 ${RARE.gcVulnerable.duration}s`,
    color: PALETTE.purple,
    rare: true,
  },
  {
    id: 'focus_transfer',
    name: '焦点转移',
    symbol: ';>',
    tagline: 'Focus Relay',
    desc: '集火层数满时击杀标记目标，把一半层数转给最近的敌人',
    color: PALETTE.yellow,
    rare: true,
  },
  {
    id: 'burn_detonate',
    name: '燃尽回响',
    symbol: '!*',
    tagline: 'Burn Detonation',
    desc: '燃烧区持续时间 -35%，结束时再爆发一次范围伤害',
    color: PALETTE.orange,
    rare: true,
  },
];

export const REPAIR_REWARD: BossReward = {
  id: 'restore',
  name: '热补丁空投',
  symbol: '+hp',
  tagline: 'Repair Drop',
  desc: '最大 HP +25，并回复 60% 最大生命',
  color: PALETTE.green,
};

export function rareModuleCount(run: RunState): number {
  return Object.values(run.rareModules).reduce((sum, level) => sum + (level ?? 0), 0);
}

function rareRequirementMet(run: RunState, id: RewardId): boolean {
  if (id === 'reflect_charge') return run.evolutions.orbit === 'orbit_reflect';
  if (id === 'gc_vulnerable') return (run.passives.gc ?? 0) > 0;
  if (id === 'focus_transfer') return run.evolutions.dart === 'dart_stack' || (run.passives.cache ?? 0) > 0;
  if (id === 'burn_detonate') return run.evolutions.bomb === 'bomb_burn';
  return false;
}

export function availableRareModules(run: RunState): BossReward[] {
  if (rareModuleCount(run) >= RARE.limit) return [];
  return RARE_MODULES.filter(
    (module) =>
      rareRequirementMet(run, module.id) &&
      (run.rareModules[module.id as RareModuleId] ?? 0) === 0,
  );
}

function evolutionReward(run: RunState, pending: WeaponId[]): BossReward | null {
  const candidates = evolutionCandidates(run, pending);
  if (candidates.length === 0) return null;
  const weapon = candidates.sort(
    (a, b) =>
      (run.weapons[b] ?? 0) - (run.weapons[a] ?? 0) || WEAPON_IDS.indexOf(a) - WEAPON_IDS.indexOf(b),
  )[0];
  return {
    id: 'evolution',
    name: `进化协议 · ${WEAPON_DEFS[weapon].name}`,
    symbol: 'evo',
    tagline: 'Evolution',
    desc: '从两条分支中选择一条，立即进化这把武器',
    color: WEAPON_DEFS[weapon].color,
    evolutionWeapon: weapon,
  };
}

function weaponLevelReward(run: RunState, rng: RewardRng): BossReward | null {
  const options = WEAPON_IDS.filter((id) => {
    const level = run.weapons[id] ?? 0;
    return level > 0 && level < WEAPON_DEFS[id].maxLevel;
  });
  if (options.length === 0) return null;
  const weapon = rng.pick(options);
  return {
    id: 'weapon_level',
    name: `模块升级 · ${WEAPON_DEFS[weapon].name}`,
    symbol: 'lv+',
    tagline: 'Module Upgrade',
    desc: `将 ${WEAPON_DEFS[weapon].name} 提升 1 级`,
    color: WEAPON_DEFS[weapon].color,
    upgradeWeapon: weapon,
  };
}

export function rollRareModule(run: RunState, rng: RewardRng): BossReward {
  const available = availableRareModules(run);
  return available.length > 0 ? rng.pick(available) : rng.pick(MODULES);
}

export function rollBossRewards(
  run: RunState,
  rng: RewardRng,
  pendingEvolutions: WeaponId[] = [],
): BossReward[] {
  const rewards: BossReward[] = [];
  let rare = availableRareModules(run);
  const evolve = evolutionReward(run, pendingEvolutions);
  if (evolve) rewards.push(evolve);
  else {
    const upgrade = weaponLevelReward(run, rng);
    if (upgrade) rewards.push(upgrade);
    else if (rare.length > 0) {
      rewards.push(rare[0]);
      rare = rare.slice(1);
    }
  }
  if (rare.length > 0) {
    const pick = rng.pick(rare);
    rewards.push(pick);
    rare = rare.filter((module) => module !== pick);
  } else {
    rewards.push(rng.pick(MODULES));
  }
  rewards.push(REPAIR_REWARD);
  for (const extra of [...rare, ...MODULES]) {
    if (rewards.length >= 3) break;
    if (!rewards.includes(extra)) rewards.push(extra);
  }
  return rewards.slice(0, 3);
}
