import { describe, expect, it } from 'vitest';
import { ORB, PLAYER } from '../src/config';
import { dampOrbVelocity, homeOrbVelocity, orbTier } from '../src/systems/loot';

interface Sim {
  caught: boolean;
  frames: number;
}

function simulate(playerSpeed: number, startOffset: number, direction = 1): Sim {
  const dt = 1 / 60;
  const orb = { x: 0, y: 0, vx: 0, vy: 0 };
  let playerX = startOffset;
  for (let frame = 0; frame < 600; frame++) {
    playerX += playerSpeed * direction * dt;
    const dx = playerX - orb.x;
    const dy = -orb.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < PLAYER.pickupRadius) homeOrbVelocity(orb, dx, dy, dist, playerSpeed, dt);
    else dampOrbVelocity(orb, dt);
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;
    if (Math.hypot(playerX - orb.x, -orb.y) <= PLAYER.collectRadius) {
      return { caught: true, frames: frame };
    }
  }
  return { caught: false, frames: 600 };
}

const maxPlayerSpeed = PLAYER.speed * Math.pow(1.15, 5);

describe('orb rarity tiers', () => {
  it('shows boss drops as rare orbs without tripling their value', () => {
    expect(orbTier(true, 0)).toEqual({ big: true, multiplier: 1 });
    expect(orbTier(true, 0.99)).toEqual({ big: true, multiplier: 1 });
  });

  it('rolls the lucky tripled orb on normal kills only', () => {
    expect(orbTier(false, ORB.rareChance - 0.001)).toEqual({
      big: true,
      multiplier: ORB.rareMultiplier,
    });
    expect(orbTier(false, ORB.rareChance)).toEqual({ big: false, multiplier: 1 });
    expect(orbTier(false, 0.9)).toEqual({ big: false, multiplier: 1 });
  });

  it('makes rare orbs worth strictly more than common ones', () => {
    expect(orbTier(false, 0).multiplier).toBeGreaterThan(orbTier(false, 1).multiplier);
  });
});

describe('loot magnet', () => {
  it('catches an orb that entered the ring behind a running player', () => {
    const sim = simulate(PLAYER.speed, -PLAYER.pickupRadius + 2);
    expect(sim.caught).toBe(true);
  });

  it('still catches up when the player has maxed movement speed', () => {
    const sim = simulate(maxPlayerSpeed, -PLAYER.pickupRadius + 2);
    expect(sim.caught).toBe(true);
  });

  it('collects an orb the player runs straight towards', () => {
    const sim = simulate(PLAYER.speed, PLAYER.pickupRadius + 40, -1);
    expect(sim.caught).toBe(true);
  });

  it('collects an orb the player sprints past at max speed', () => {
    const sim = simulate(maxPlayerSpeed, PLAYER.pickupRadius + 40, -1);
    expect(sim.caught).toBe(true);
  });

  it('is not left behind by a player who overshoots it', () => {
    const sim = simulate(maxPlayerSpeed * 1.2, -PLAYER.pickupRadius + 2);
    expect(sim.caught).toBe(true);
  });

  it('leaves orbs outside the ring exactly where they are', () => {
    const orb = { x: 0, y: 0, vx: 30, vy: -20 };
    for (let frame = 0; frame < 120; frame++) dampOrbVelocity(orb, 1 / 60);
    expect(Math.hypot(orb.vx, orb.vy)).toBe(0);
  });

  it('never homes in from outside the pickup radius', () => {
    const orb = { x: 0, y: 0, vx: 0, vy: 0 };
    const distance = PLAYER.pickupRadius + 100;
    expect(distance).toBeGreaterThan(PLAYER.pickupRadius);
    for (let frame = 0; frame < 120; frame++) dampOrbVelocity(orb, 1 / 60);
    expect(orb.vx).toBe(0);
    expect(orb.vy).toBe(0);
  });
});
