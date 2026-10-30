import type Phaser from 'phaser';
import type { ItemId } from '../data/items';

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

export type EvolutionId =
  | 'dart_bounce'
  | 'dart_stack'
  | 'orbit_wide'
  | 'orbit_reflect'
  | 'bomb_burn'
  | 'bomb_chain'
  | 'clone_focus'
  | 'clone_spread';

export type EnemyTypeId =
  | 'syntax'
  | 'nullptr'
  | 'memleak'
  | 'race'
  | 'stack'
  | 'thrower'
  | 'deadlock'
  | 'breakpoint'
  | 'daemon'
  | 'boss';

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
  evolutions: Partial<Record<WeaponId, EvolutionId>>;
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
  summoned: boolean;
  phasing: boolean;
  dead: boolean;
  sprite: Phaser.GameObjects.Image | null;
  hitAt: number;
  touchAt: number;
  castAt: number;
  summonAt: number;
  summonQueue?: number;
  summonSize?: number;
  spiralShots?: number;
  spiralAt?: number;
  spiralAngle?: number;
  growT: number;
  orbitHit: number[];
  knockX: number;
  knockY: number;
  slowUntil?: number;
  lastWeapon?: WeaponId;
  challenge?: boolean;
  empoweredUntil?: number;
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
  weapon?: WeaponId;
  bounces?: number;
  hold?: number;
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

export interface Pickup {
  id: number;
  kind: ItemId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  bob: number;
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
  kind: 'ray' | 'cone' | 'ring';
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  spread: number;
  color: number;
  life: number;
  maxLife: number;
  grow?: number;
}
