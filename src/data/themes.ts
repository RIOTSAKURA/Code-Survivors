import { COMBAT, PALETTE } from '../config';
import type { EnemyTypeId } from '../core/types';
import { ENEMY_DEFS, SPAWN_POOL, pickEnemyType } from './enemies';

export type CombatThemeId = 'support' | 'route' | 'cleanup' | 'breather';

export interface CombatThemeDef {
  id: CombatThemeId;
  label: string;
  name: string;
  duration: number;
  spawnRate: number;
  hpScale: number;
  xpScale: number;
  daemonCap: number;
  breakpointCap: number;
  weights: Partial<Record<EnemyTypeId, number>>;
  color: number;
}

export interface ActiveTheme {
  def: CombatThemeDef;
  index: number;
  startedAt: number;
  until: number;
}

const COLORS: Record<CombatThemeId, number> = {
  support: PALETTE.purple,
  route: PALETTE.cyan,
  cleanup: PALETTE.green,
  breather: PALETTE.yellow,
};

export const COMBAT_THEMES: CombatThemeDef[] = COMBAT.themes.map((theme) => ({
  id: theme.id as CombatThemeId,
  label: theme.label,
  name: theme.name,
  duration: theme.duration,
  spawnRate: theme.spawnRate,
  hpScale: theme.hpScale,
  xpScale: theme.xpScale,
  daemonCap: 'daemonCap' in theme ? theme.daemonCap : 0,
  breakpointCap: 'breakpointCap' in theme ? theme.breakpointCap : 0,
  weights: theme.weights as Partial<Record<EnemyTypeId, number>>,
  color: COLORS[theme.id as CombatThemeId],
}));

export function themeCycleLength(): number {
  return COMBAT_THEMES.reduce((sum, theme) => sum + theme.duration, 0);
}

export function themeAt(time: number): ActiveTheme | null {
  if (time < COMBAT.startAt) return null;
  const cycle = themeCycleLength();
  if (cycle <= 0) return null;
  let offset = (time - COMBAT.startAt) % cycle;
  for (let i = 0; i < COMBAT_THEMES.length; i++) {
    const def = COMBAT_THEMES[i];
    if (offset < def.duration) {
      return {
        def,
        index: i,
        startedAt: time - offset,
        until: time + (def.duration - offset),
      };
    }
    offset -= def.duration;
  }
  return null;
}

export function themeSpawnWeights(
  theme: CombatThemeDef | null,
  time: number,
): Partial<Record<EnemyTypeId, number>> {
  if (!theme || Object.keys(theme.weights).length === 0) {
    const base: Partial<Record<EnemyTypeId, number>> = {};
    for (const id of SPAWN_POOL) base[id] = ENEMY_DEFS[id].weight(time);
    return base;
  }
  return theme.weights;
}

export function pickThemedEnemyType(
  theme: CombatThemeDef | null,
  time: number,
  roll: number,
): EnemyTypeId {
  const weights = themeSpawnWeights(theme, time);
  const pool = SPAWN_POOL.filter((id) => time >= ENEMY_DEFS[id].unlockAt && (weights[id] ?? 0) > 0);
  const total = pool.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  if (total <= 0) return pickEnemyType(time, roll);
  let acc = roll * total;
  for (const id of pool) {
    acc -= weights[id] ?? 0;
    if (acc <= 0) return id;
  }
  return pool[pool.length - 1];
}

export function themeCapBonus(theme: CombatThemeDef | null, id: EnemyTypeId): number {
  if (!theme) return 0;
  if (id === 'daemon') return theme.daemonCap;
  if (id === 'breakpoint') return theme.breakpointCap;
  return 0;
}
