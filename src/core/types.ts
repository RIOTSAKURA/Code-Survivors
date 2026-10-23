import type Phaser from 'phaser';

export type WeaponId = 'dart' | 'orbit' | 'bomb' | 'ray' | 'cone' | 'clone';

export type PassiveId =
  | 'multicore'
  | 'cache'
  | 'memory'
  | 'gc'
  | 'compile'
  | 'typesafe'
  | 'parallel'
  | 'quantum';

export type UpgradeId = WeaponId | PassiveId;

export type EnemyTypeId = 'syntax' | 'nullptr' | 'memleak' | 'race' | 'stack' | 'boss';

export interface Stats {
  maxHp: number;
  speed: number;
  pickupRadius: number;
  armor: number;
  damageMult: number;
  cooldownMult: number;
  projectileBonus: number;
  splitChance: number;
}

export interface RunState {
  stats: Stats;
  hp: number;
  level: number;
  xp: number;
  kills: number;
  time: number;
  weapons: Partial<Record<WeaponId, number>>;
  passives: Partial<Record<PassiveId, number>>;
  pendingLevels: number;
  over: boolean;
}

export interface Enemy {
  id: number;
  type: EnemyTypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  xp: number;
  color: number;
  glyph: string;
  boss: boolean;
  elite: boolean;
  phasing: boolean;
  dead: boolean;
  sprite: Phaser.GameObjects.Image | null;
  hitAt: number;
  touchAt: number;
  blinkAt: number;
  castAt: number;
  summonAt: number;
  growT: number;
  orbitHit: number[];
  knockX: number;
  knockY: number;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  life: number;
  pierce: number;
  hostile: boolean;
  color: number;
  sprite: Phaser.GameObjects.Image | null;
  hit: Set<number>;
  split: boolean;
  trailAt: number;
  fuse: number;
  blast: number;
  dead: boolean;
}

export interface Orbiter {
  index: number;
  angle: number;
  radius: number;
  damage: number;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image | null;
}

export interface Clone {
  angle: number;
  distance: number;
  x: number;
  y: number;
  fireAt: number;
  damage: number;
  sprite: Phaser.GameObjects.Image | null;
}

export interface Orb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  big: boolean;
  life: number;
  sprite: Phaser.GameObjects.Image | null;
  dead: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  drag: number;
  size: number;
  color: number;
  spin: number;
  sprite: Phaser.GameObjects.Image | null;
  dead: boolean;
}

export interface Beam {
  kind: 'ray' | 'cone';
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  spread: number;
  color: number;
  life: number;
  maxLife: number;
}
