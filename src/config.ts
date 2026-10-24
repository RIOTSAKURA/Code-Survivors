const rawDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

export const DPR = Math.min(2, Math.max(1, rawDpr));

export const TEX_SCALE = 1 / DPR;

export const WORLD = {
  width: 5600,
  height: 5600,
};

export const PALETTE = {
  bg: 0x1e1e2e,
  bgDeep: 0x181825,
  grid: 0x2a2a3c,
  gridMajor: 0x353548,
  text: 0xcdd6f4,
  textDim: 0x6c7086,
  cyan: 0x00ffff,
  green: 0x00ff41,
  orange: 0xffa500,
  red: 0xff0040,
  purple: 0xbd5fff,
  blue: 0x4aa8ff,
  yellow: 0xffe066,
  white: 0xffffff,
};

export const PLAYER = {
  maxHp: 100,
  speed: 200,
  pickupRadius: 145,
  radius: 15,
  invulnTime: 0.7,
  magnetGain: 6.5,
  magnetCatchUp: 1.8,
  collectRadius: 26,
};

export const SPAWN = {
  maxEnemies: 420,
  rateBase: 1.45,
  rateGrowth: 0.05,
  rateMax: 26,
  maxPerFrame: 12,
  ringPadding: 50,
  engageRange: 300,
  beamRange: 460,
  xpValueScale: 2.7,
  bossFirstAt: 95,
  bossEvery: 115,
  hpScalePerMin: 0.26,
  hpScalePerLevel: 0.045,
  speedScalePerMin: 0.035,
};

export const ORB = {
  lifetime: 20,
  bigLifetime: 35,
  blinkTime: 7,
  rareChance: 0.03,
  rareMultiplier: 3,
};

import type { EnemyTypeId } from './core/types';

export const BOSS = {
  range: 1000,
  barrage: {
    every: 2.1,
    bullets: 12,
    speed: 200,
    damage: 9,
    sparseEvery: 3.8,
    sparseBullets: 8,
    sparseSpeed: 165,
    sparseDamage: 8,
  },
  summon: {
    openerVolleys: 3,
    openerPerVolley: 7,
    volleys: 3,
    perVolley: 6,
    volleyGap: 0.28,
    every: 8.5,
    heavyEvery: 10,
    heavyVolleys: 2,
    heavyPerVolley: 5,
    pool2: ['race', 'race', 'race', 'memleak', 'memleak', 'memleak'] as EnemyTypeId[],
    pool3: ['race', 'memleak', 'memleak', 'stack', 'stack'] as EnemyTypeId[],
  },
  spiral: {
    every: 0.07,
    shots: 16,
    arms: 3,
    turn: 0.34,
    speed: 200,
    damage: 10,
    chance: 0.55,
    ringEvery: 1.9,
  },
  ring: {
    bullets: 14,
    speedFast: 235,
    speedSlow: 125,
    damage: 9,
  },
};

export const ENTRANCE = {
  panMs: 420,
  chargeMs: 240,
  waveSpeed: 1900,
  waveFloor: 600,
  waveCeil: 1600,
  holdMs: 160,
  returnMs: 380,
  ringEveryMs: 60,
};

export const DEPTH = {
  ground: -10,
  orb: 4,
  enemy: 6,
  boss: 7,
  orbiter: 9,
  clone: 9,
  player: 10,
  projectile: 11,
  beam: 12,
  particle: 14,
  floater: 16,
};

export const MONO_FONT = '"JetBrains Mono", "Fira Code", ui-monospace, monospace';
