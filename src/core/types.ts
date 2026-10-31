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
  | 'ray_lock'
  | 'ray_sweep'
  | 'cone_burst'
  | 'cone_wall'
  | 'clone_focus'
  | 'clone_spread';

export type RareModuleId =
  | 'reflect_charge'
  | 'gc_vulnerable'
  | 'focus_transfer'
  | 'burn_detonate';

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
  | 'boss'
  | 'boss2';

export type DamageSource =
  | WeaponId
  | 'gc'
  | 'reflect'
  | 'terrain'
  | 'event'
  | 'other';

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

export interface LastHit {
  source: string;
  amount: number;
  at: number;
}

export interface EventTally {
  accepted: number;
  completed: number;
  failed: number;
  expired: number;
}

export interface RunSummary {
  damage: Partial<Record<DamageSource, number>>;
  bossDamage: Partial<Record<DamageSource, number>>;
  overkill: number;
  cacheActiveTime: number;
  parallelBonus: number;
  gcSweeps: number;
  shieldsBlocked: number;
  events: EventTally;
  lastHit: LastHit | null;
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
  rareModules: Partial<Record<RareModuleId, number>>;
  summary: RunSummary;
  pendingLevels: number;
  over: boolean;
  weaponSlots: number;
  rerolls: number;
  skips: number;
  bossKills: number;
  endless: boolean;
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
  lastDamageSource?: DamageSource;
  vulnerableUntil?: number;
  vulnerableMult?: number;
  challenge?: boolean;
  empoweredUntil?: number;
  weakAngle?: number;
  weakAt?: number;
  weakUntil?: number;
  weakNext?: number;
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
  reflected?: boolean;
  sourceLabel?: string;
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
