import { describe, expect, it } from 'vitest';
import { PALETTE, SHIELD } from '../src/config';
import { reflectBullet } from '../src/systems/shield';

const hostile = (vx = 100, vy = 0, damage = 9) => ({ vx, vy, damage, hostile: true });

describe('paren shield reflection', () => {
  it('sends hostile fire back the way it came, harder', () => {
    const shot = hostile(120, -40, 10);
    const out = reflectBullet(10, shot);
    expect(out).not.toBeNull();
    expect(out!.vx).toBeCloseTo(-120 * SHIELD.reflectSpeedScale, 6);
    expect(out!.vy).toBeCloseTo(40 * SHIELD.reflectSpeedScale, 6);
    expect(out!.damage).toBeCloseTo(10 * SHIELD.reflectDamageScale, 6);
    expect(out!.damage).toBeGreaterThan(shot.damage);
  });

  it('only reaches as far as the shield sweeps', () => {
    expect(reflectBullet(SHIELD.reflectRadius, hostile())).not.toBeNull();
    expect(reflectBullet(SHIELD.reflectRadius + 1, hostile())).toBeNull();
    expect(reflectBullet(0, hostile())).not.toBeNull();
  });

  it('never touches the player own fire', () => {
    const mine = { vx: 100, vy: 0, damage: 20, hostile: false };
    expect(reflectBullet(1, mine)).toBeNull();
  });

  it('keeps the reflection worth building around', () => {
    expect(SHIELD.reflectDamageScale).toBeGreaterThan(1);
    expect(SHIELD.reflectSpeedScale).toBeGreaterThan(1);
    expect(SHIELD.reflectRadius).toBeGreaterThan(20);
    expect(SHIELD.reflectMinLife).toBeGreaterThan(1);
    expect(PALETTE.green).not.toBe(PALETTE.cyan);
  });

  it('lets the reflect evolution widen the sweep and harden the hit', () => {
    const shot = hostile(100, 0, 10);
    const out = reflectBullet(40, shot, { radius: 46, damageScale: 2.4, speedScale: 1.55 });
    expect(out).not.toBeNull();
    expect(out!.vx).toBeCloseTo(-155, 6);
    expect(out!.damage).toBeCloseTo(24, 6);
    expect(reflectBullet(47, shot, { radius: 46 })).toBeNull();
  });
});
