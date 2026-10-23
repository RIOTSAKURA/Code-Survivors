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
