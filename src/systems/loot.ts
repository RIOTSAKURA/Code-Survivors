import { PLAYER } from '../config';

export interface Motion {
  vx: number;
  vy: number;
}

export function homeOrbVelocity(
  motion: Motion,
  dx: number,
  dy: number,
  dist: number,
  playerSpeed: number,
  dt: number,
): void {
  const speed = Math.max(playerSpeed * PLAYER.magnetCatchUp, dist * PLAYER.magnetGain);
  const blend = Math.min(1, dt * 18);
  motion.vx += ((dx / dist) * speed - motion.vx) * blend;
  motion.vy += ((dy / dist) * speed - motion.vy) * blend;
}

export function dampOrbVelocity(motion: Motion, dt: number): void {
  const decay = Math.pow(0.86, dt * 60);
  motion.vx *= decay;
  motion.vy *= decay;
  if (Math.abs(motion.vx) < 2) motion.vx = 0;
  if (Math.abs(motion.vy) < 2) motion.vy = 0;
}
