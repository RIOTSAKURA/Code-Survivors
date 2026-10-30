import { PALETTE } from '../config';
import type { RunState, WeaponId } from '../core/types';
import { evolutionCandidates } from './evolutions';
import { WEAPON_DEFS, WEAPON_IDS } from './weapons';

export type RewardId =
  | 'evolution'
  | 'weapon_level'
  | 'module_damage'
  | 'module_cooldown'
  | 'module_armor'
  | 'module_speed'
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

export const REPAIR_REWARD: BossReward = {
  id: 'restore',
  name: '热补丁空投',
  symbol: '+hp',
  tagline: 'Repair Drop',
  desc: '最大 HP +25，并回复 60% 最大生命',
  color: PALETTE.green,
};

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

export function rollRareModule(rng: RewardRng): BossReward {
  return rng.pick(MODULES);
}

export function rollBossRewards(
  run: RunState,
  rng: RewardRng,
  pendingEvolutions: WeaponId[] = [],
): BossReward[] {
  const rewards: BossReward[] = [];
  const evolve = evolutionReward(run, pendingEvolutions);
  if (evolve) rewards.push(evolve);
  else {
    const upgrade = weaponLevelReward(run, rng);
    if (upgrade) rewards.push(upgrade);
  }
  rewards.push(rng.pick(MODULES));
  rewards.push(REPAIR_REWARD);
  for (const extra of MODULES) {
    if (rewards.length >= 3) break;
    if (!rewards.includes(extra)) rewards.push(extra);
  }
  return rewards;
}
