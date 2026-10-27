import { TERRAIN } from '../config';
import type { ZoneKind } from '../data/terrain';

export interface ZoneMods {
  speed: number;
  cooldown: number;
}

const NEUTRAL: ZoneMods = { speed: 1, cooldown: 1 };

export function zoneMods(kind: ZoneKind | null, charge: number): ZoneMods {
  const level = Math.min(1, Math.max(0, charge));
  if (kind === 'include') return { speed: 1, cooldown: 1 - TERRAIN.effects.includeCooldown * level };
  if (kind === 'pragma') return { speed: 1 + TERRAIN.effects.pragmaSpeed * level, cooldown: 1 };
  if (kind === 'leak') return { speed: TERRAIN.effects.leakSpeed, cooldown: 1 };
  return { speed: NEUTRAL.speed, cooldown: NEUTRAL.cooldown };
}

export function isZoneSpent(kind: ZoneKind, charge: number): boolean {
  if (kind !== 'include' && kind !== 'pragma') return false;
  return charge <= 0;
}

export function stepCharge(inside: boolean, charge: number, dt: number): number {
  if (inside) return Math.min(1, Math.max(0, charge - dt / TERRAIN.charge.sustain));
  if (charge <= 0) return 0;
  return Math.min(1, Math.max(0, charge + dt / TERRAIN.charge.recover));
}

export function zoneHazard(kind: ZoneKind): { playerDps: number; enemyDps: number } {
  if (kind !== 'crash') return { playerDps: 0, enemyDps: 0 };
  return { playerDps: TERRAIN.effects.crashPlayerDps, enemyDps: TERRAIN.effects.crashEnemyDps };
}
