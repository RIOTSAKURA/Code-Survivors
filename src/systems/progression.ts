import { PASSIVE_DEFS, PASSIVE_IDS } from '../data/passives';
import { WEAPON_DEFS, WEAPON_IDS } from '../data/weapons';
import type { PassiveId, RunState, UpgradeId, WeaponId } from '../core/types';

export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;

export interface RngLike {
  next(): number;
  range(min: number, max: number): number;
}

export interface UpgradeCard {
  id: UpgradeId;
  kind: 'weapon' | 'passive';
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
}

export function xpForLevel(level: number): number {
  return Math.floor(8 + level * 3.6 + Math.pow(level, 1.3));
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

export function applyUpgrade(run: RunState, id: UpgradeId): void {
  const stats = run.stats;
  if (WEAPON_IDS.includes(id as WeaponId)) {
    const weaponId = id as WeaponId;
    const level = (run.weapons[weaponId] ?? 0) + 1;
    run.weapons[weaponId] = Math.min(level, WEAPON_DEFS[weaponId].maxLevel);
    return;
  }
  const passiveId = id as PassiveId;
  const level = (run.passives[passiveId] ?? 0) + 1;
  run.passives[passiveId] = Math.min(level, PASSIVE_DEFS[passiveId].maxLevel);
  switch (passiveId) {
    case 'multicore':
      stats.projectileBonus += 1;
      break;
    case 'cache':
      stats.cooldownMult *= 0.83;
      break;
    case 'memory':
      stats.maxHp += 20;
      run.hp = Math.min(stats.maxHp, run.hp + 20);
      break;
    case 'gc':
      stats.pickupRadius *= 1.3;
      break;
    case 'compile':
      stats.speed *= 1.15;
      break;
    case 'typesafe':
      stats.armor += 1;
      break;
    case 'parallel':
      stats.cooldownMult *= 0.9;
      break;
    case 'quantum':
      stats.splitChance += 0.15;
      break;
  }
}
