import { EVOLUTION_DEFS, EVOLUTION_LEVEL, isEvolutionWeapon } from '../data/evolutions';
import { PASSIVE_DEFS, PASSIVE_IDS } from '../data/passives';
import type { BossReward } from '../data/rewards';
import { WEAPON_DEFS, WEAPON_IDS } from '../data/weapons';
import type { EvolutionId, PassiveId, RunState, UpgradeId, WeaponId } from '../core/types';

export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;

export interface RngLike {
  next(): number;
  range(min: number, max: number): number;
}

export interface ChoiceCard {
  kind: 'weapon' | 'passive' | 'evolution' | 'reward';
  name: string;
  symbol: string;
  tagline: string;
  desc: string;
  level: number;
  nextLevel: number;
  maxLevel: number;
  isNew: boolean;
  maxed: boolean;
  color: number;
  label?: string;
  chip?: string;
}

export interface UpgradeCard extends ChoiceCard {
  id: UpgradeId;
  kind: 'weapon' | 'passive';
}

export function xpForLevel(level: number): number {
  return Math.floor(8 + level * 2 + Math.pow(level, 1.65));
}

const OPENING_WEAPONS: WeaponId[] = ['dart', 'bomb', 'ray', 'cone'];

export function ownedWeaponCount(run: RunState): number {
  return Object.keys(run.weapons).length;
}

export function ownedPassiveCount(run: RunState): number {
  return Object.keys(run.passives).length;
}

export function upgradeWeight(run: RunState, id: UpgradeId): number {
  if (WEAPON_IDS.includes(id as WeaponId)) {
    const def = WEAPON_DEFS[id as WeaponId];
    const level = run.weapons[id as WeaponId] ?? 0;
    if (level >= def.maxLevel) return 0;
    if (level === 0) return ownedWeaponCount(run) >= MAX_WEAPONS ? 0 : 1;
    return 1.35;
  }
  const def = PASSIVE_DEFS[id as PassiveId];
  const level = run.passives[id as PassiveId] ?? 0;
  if (level >= def.maxLevel) return 0;
  if (level === 0) return ownedPassiveCount(run) >= MAX_PASSIVES ? 0 : 0.95;
  return 1.15;
}

export function pickChoices(run: RunState, rng: RngLike, count = 3): UpgradeId[] {
  const opening = ownedWeaponCount(run) === 0;
  const all: UpgradeId[] = opening ? [...OPENING_WEAPONS] : [...WEAPON_IDS, ...PASSIVE_IDS];
  const weights = all.map((id) => (opening ? 1 : upgradeWeight(run, id)));
  const picked: UpgradeId[] = [];
  for (let n = 0; n < count; n++) {
    let total = 0;
    for (let i = 0; i < all.length; i++) total += weights[i];
    if (total <= 0) break;
    let roll = rng.next() * total;
    let chosen = -1;
    for (let i = 0; i < all.length; i++) {
      roll -= weights[i];
      if (weights[i] > 0 && roll <= 0) {
        chosen = i;
        break;
      }
    }
    if (chosen < 0) {
      chosen = weights.findIndex((w, i) => w > 0 && !picked.includes(all[i]));
    }
    if (chosen < 0) break;
    picked.push(all[chosen]);
    weights[chosen] = 0;
  }
  return picked;
}

export function toCard(run: RunState, id: UpgradeId): UpgradeCard {
  if (WEAPON_IDS.includes(id as WeaponId)) {
    const def = WEAPON_DEFS[id as WeaponId];
    const level = run.weapons[id as WeaponId] ?? 0;
    const next = level + 1;
    return {
      id,
      kind: 'weapon',
      name: def.name,
      symbol: def.symbol,
      tagline: def.tagline,
      desc: level === 0 ? `新武器 · ${def.detail(1)}` : def.note(level),
      level,
      nextLevel: next,
      maxLevel: def.maxLevel,
      isNew: level === 0,
      maxed: level >= def.maxLevel,
      color: def.color,
    };
  }
  const def = PASSIVE_DEFS[id as PassiveId];
  const level = run.passives[id as PassiveId] ?? 0;
  return {
    id,
    kind: 'passive',
    name: def.name,
    symbol: def.symbol,
    tagline: def.tagline,
    desc: level === 0 ? def.desc : def.note,
    level,
    nextLevel: level + 1,
    maxLevel: def.maxLevel,
    isNew: level === 0,
    maxed: level >= def.maxLevel,
    color: def.color,
  };
}

export function toEvolutionCard(id: EvolutionId): ChoiceCard {
  const def = EVOLUTION_DEFS[id];
  return {
    kind: 'evolution',
    name: def.name,
    symbol: def.symbol,
    tagline: def.tagline,
    desc: def.desc,
    level: 0,
    nextLevel: 0,
    maxLevel: 0,
    isNew: false,
    maxed: false,
    color: def.color,
    label: `BRANCH ${def.branch}`,
    chip: 'EVOLVE',
  };
}

export function toBossRewardCard(reward: BossReward): ChoiceCard {
  return {
    kind: 'reward',
    name: reward.name,
    symbol: reward.symbol,
    tagline: reward.tagline,
    desc: reward.desc,
    level: 0,
    nextLevel: 0,
    maxLevel: 0,
    isNew: false,
    maxed: false,
    color: reward.color,
    label: 'BOSS DROP',
    chip: 'REWARD',
  };
}

export function canEvolve(run: RunState, weapon: WeaponId): boolean {
  return (
    isEvolutionWeapon(weapon) &&
    (run.weapons[weapon] ?? 0) >= EVOLUTION_LEVEL &&
    !run.evolutions[weapon]
  );
}

export function applyEvolution(run: RunState, id: EvolutionId): WeaponId | null {
  const def = EVOLUTION_DEFS[id];
  if (!isEvolutionWeapon(def.weapon)) return null;
  if ((run.weapons[def.weapon] ?? 0) <= 0) return null;
  if (run.evolutions[def.weapon]) return null;
  run.evolutions[def.weapon] = id;
  return def.weapon;
}

export interface RewardOutcome {
  evolve: WeaponId | null;
  upgraded: WeaponId | null;
}

export function applyBossReward(run: RunState, reward: BossReward): RewardOutcome {
  const outcome: RewardOutcome = { evolve: null, upgraded: null };
  switch (reward.id) {
    case 'evolution':
      outcome.evolve = reward.evolutionWeapon ?? null;
      break;
    case 'weapon_level':
      if (reward.upgradeWeapon) {
        applyUpgrade(run, reward.upgradeWeapon);
        outcome.upgraded = reward.upgradeWeapon;
      }
      break;
    case 'module_damage':
      run.stats.damageMult *= 1.18;
      break;
    case 'module_cooldown':
      run.stats.cooldownMult *= 0.88;
      break;
    case 'module_armor':
      run.stats.armor += 1;
      break;
    case 'module_speed':
      run.stats.speed *= 1.1;
      break;
    case 'restore':
      run.stats.maxHp += 25;
      run.hp = Math.min(run.stats.maxHp, run.hp + run.stats.maxHp * 0.6);
      break;
  }
  return outcome;
}

export function applyUpgrade(run: RunState, id: UpgradeId): void {
  const stats = run.stats;
  if (WEAPON_IDS.includes(id as WeaponId)) {
    const weaponId = id as WeaponId;
    const level = run.weapons[weaponId] ?? 0;
    if (level >= WEAPON_DEFS[weaponId].maxLevel) return;
    run.weapons[weaponId] = level + 1;
    return;
  }
  const passiveId = id as PassiveId;
  const level = run.passives[passiveId] ?? 0;
  if (level >= PASSIVE_DEFS[passiveId].maxLevel) return;
  run.passives[passiveId] = level + 1;
  switch (passiveId) {
    case 'multicore':
      stats.projectileBonus += 1;
      break;
    case 'memory':
      stats.maxHp += 20;
      run.hp = Math.min(stats.maxHp, run.hp + 20);
      break;
    case 'compile':
      stats.speed *= 1.15;
      break;
    case 'quantum':
      stats.splitChance += 0.15;
      break;
  }
}
