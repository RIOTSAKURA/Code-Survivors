import { SHIELD } from '../config';

export interface Bullet {
  vx: number;
  vy: number;
  damage: number;
  hostile: boolean;
}

export interface Reflection {
  vx: number;
  vy: number;
  damage: number;
}

export interface ReflectConfig {
  radius?: number;
  damageScale?: number;
  speedScale?: number;
}

export function reflectBullet(
  distance: number,
  bullet: Bullet,
  config: ReflectConfig = {},
): Reflection | null {
  if (!bullet.hostile) return null;
  if (distance > (config.radius ?? SHIELD.reflectRadius)) return null;
  const speedScale = config.speedScale ?? SHIELD.reflectSpeedScale;
  return {
    vx: -bullet.vx * speedScale,
    vy: -bullet.vy * speedScale,
    damage: bullet.damage * (config.damageScale ?? SHIELD.reflectDamageScale),
  };
}
