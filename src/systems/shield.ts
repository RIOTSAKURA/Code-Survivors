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

export function reflectBullet(distance: number, bullet: Bullet): Reflection | null {
  if (!bullet.hostile) return null;
  if (distance > SHIELD.reflectRadius) return null;
  return {
    vx: -bullet.vx * SHIELD.reflectSpeedScale,
    vy: -bullet.vy * SHIELD.reflectSpeedScale,
    damage: bullet.damage * SHIELD.reflectDamageScale,
  };
}
