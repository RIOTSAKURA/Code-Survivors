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
  rateGrowth: 0.04,
  rateMax: 26,
  rateRampFloor: 0.65,
  rateRampCeil: 0.8,
  rateRampTime: 260,
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
    phase1: { every: 2.1, bullets: 12, speed: 200, damage: 9 },
    phase2: { every: 1.9, bullets: 14, speed: 215, damage: 11 },
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
    spawnFan: 0.9,
    spawnNearGap: 60,
    spawnNearSpread: 190,
    tankAfter: 240,
    pool2: ['race', 'race', 'race', 'memleak', 'memleak', 'thrower'] as EnemyTypeId[],
    pool3: ['race', 'memleak', 'stack', 'stack', 'thrower'] as EnemyTypeId[],
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

export const TERRAIN = {
  zoneCount: 10,
  zoneRadiusMin: 130,
  zoneRadiusMax: 220,
  zoneSpreadMin: 90,
  zoneMargin: 320,
  startSafeRadius: 620,
  decorCount: 72,
  towerMargin: 60,
  zoneShuffleEvery: 45,
  zonePlayerGap: 170,
  event: {
    chargeTime: 9,
    spawnEvery: 1.7,
    spawnCount: 2,
    compileAttackSpeed: 0.9,
    compileDamageTaken: 1.1,
  },
  eventSystem: {
    firstDelay: 50,
    cooldown: 30,
    acceptWindow: 20,
    bossBuffer: 40,
  },
  packet: {
    fightTime: 18,
    guards: 3,
    guardDistance: 150,
    guardHpScale: 1.4,
    guardDamageScale: 1.2,
  },
  commit: {
    duration: 15,
    need: 20,
    spawnEvery: 0.9,
    spawnCount: 2,
    hpScale: 1.5,
    damageScale: 1.25,
  },
  charge: { sustain: 14, recover: 9 },
  effects: {
    includeCooldown: 0.2,
    pragmaSpeed: 0.25,
    leakSpeed: 0.72,
    crashPlayerDps: 5,
    crashEnemyDps: 20,
  },
};

export const ITEM = {
  rate: { hotfix: 0.014, fetch: 0.008, sigkill: 0.0032 },
  heal: 30,
  empBossPct: 0.15,
  grabRadius: 46,
  lifetime: 30,
  blinkTime: 6,
};

export const SHIELD = {
  reflectRadius: 30,
  reflectDamageScale: 1.6,
  reflectSpeedScale: 1.35,
  reflectMinLife: 2.5,
};

export const THROWER = {
  holdDistance: 260,
  retreatDistance: 200,
  castEvery: 2.4,
  castFirst: 1.8,
  bullets: 3,
  spread: 0.2,
  speed: 165,
  damage: 9,
  range: 620,
};

export const DEADLOCK = {
  pairRange: 420,
  arm: 0.8,
  duration: 2.4,
  cooldown: 3.5,
  damage: 14,
  thickness: 16,
  hitEvery: 0.5,
};

export const BREAKPOINT = {
  radius: 100,
  arm: 2,
  damage: 10,
  castEvery: 5.5,
  castFirst: 3.2,
  range: 620,
  holdDistance: 280,
  retreatDistance: 210,
  maxAlive: 3,
};

export const DAEMON = {
  radius: 220,
  speed: 1.25,
  damage: 1.3,
  linger: 2,
  maxAlive: 2,
  maxTargets: 6,
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

export const MONO_FONT = '"JetBrains Mono", "Noto Sans SC", ui-monospace, monospace';
