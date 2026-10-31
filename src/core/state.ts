import { PLAYER, RUN } from '../config';
import type { RunState, RunSummary, Stats } from './types';

export function createStats(): Stats {
  return {
    maxHp: PLAYER.maxHp,
    speed: 200,
    pickupRadius: 68,
    armor: 0,
    damageMult: 1,
    cooldownMult: 1,
    projectileBonus: 0,
    splitChance: 0,
  };
}

export function createSummary(): RunSummary {
  return {
    damage: {},
    bossDamage: {},
    overkill: 0,
    cacheActiveTime: 0,
    parallelBonus: 0,
    gcSweeps: 0,
    shieldsBlocked: 0,
    events: { accepted: 0, completed: 0, failed: 0, expired: 0 },
    lastHit: null,
  };
}

export function createRun(weaponSlots = RUN.weaponSlots): RunState {
  const stats = createStats();
  return {
    stats,
    hp: stats.maxHp,
    level: 1,
    xp: 0,
    kills: 0,
    time: 0,
    weapons: {},
    passives: {},
    evolutions: {},
    rareModules: {},
    summary: createSummary(),
    pendingLevels: 0,
    over: false,
    weaponSlots,
    rerolls: RUN.rerolls,
    skips: RUN.skips,
    bossKills: 0,
    endless: false,
  };
}

export interface HudEntry {
  symbol: string;
  level: number;
  color: number;
  max: boolean;
  evolution?: 'A' | 'B';
}

export type PanelKind = 'level' | 'free' | 'evolution' | 'reward';

export interface CacheHud {
  stacks: number;
  max: number;
}

export interface GcHud {
  charge: number;
  need: number;
  sweeps: number;
}

export interface HazardHud {
  links: number;
  marks: number;
  breakpoints: number;
  daemons: number;
  empowered: number;
}

export interface EventHud {
  kind: 'compile' | 'packet' | 'commit';
  label: string;
  name: string;
  color: number;
  charge: number;
  progress: number;
  active: boolean;
  interactable: boolean;
  detail: string;
  fragments: { x: number; y: number; got: boolean; guards: number[] }[];
}

export interface BossHud {
  name: string;
  hp: number;
  maxHp: number;
  phase: number;
  weak?: boolean;
}

export interface ZoneHud {
  label: string;
  name: string;
  charge: number;
  good: boolean;
}

export interface FocusHud {
  name: string;
  color: number;
  stacks: number;
  max: number;
  timeLeft: number;
}

export interface ThemeHud {
  label: string;
  name: string;
  color: number;
  timeLeft: number;
}

export interface RunReport {
  time: number;
  kills: number;
  level: number;
  weapons: number;
  weaponSlots: number;
  bossKills: number;
  build: string;
  loadout: { weapons: string[]; passives: string[]; rare: string[] };
  stats: { damageMult: number; cooldownMult: number; armor: number; speed: number };
  summary: RunSummary;
  victory: boolean;
}

export interface HudState {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNeed: number;
  time: number;
  kills: number;
  weapons: HudEntry[];
  passives: HudEntry[];
  version: number;
  gameOver: boolean;
  victory: boolean;
  paused: boolean;
  damageFlash: number;
  magnet: number;
  boss: BossHud | null;
  choices: number;
  confirming: boolean;
  zone: ZoneHud | null;
  theme: ThemeHud | null;
  focus: FocusHud | null;
  events: EventHud[];
  cache: CacheHud | null;
  gc: GcHud | null;
  shield: boolean;
  parallelHits: number;
  rareModules: number;
  shieldCharge: number;
  bossKills: number;
  rerolls: number;
  skips: number;
  weaponSlots: number;
  hazards: HazardHud;
  player: { x: number; y: number };
  panel: PanelKind | null;
  panelCards: number;
  zones: number;
  seed: number;
  orbs: number;
  enemies: number;
  items: number;
}

export const hud: HudState = {
  hp: 100,
  maxHp: 100,
  level: 1,
  xp: 0,
  xpNeed: 10,
  time: 0,
  kills: 0,
  weapons: [],
  passives: [],
  version: 0,
  gameOver: false,
  victory: false,
  paused: false,
  damageFlash: 0,
  magnet: 68,
  boss: null,
  choices: 0,
  confirming: false,
  zone: null,
  theme: null,
  focus: null,
  events: [],
  cache: null,
  gc: null,
  shield: false,
  parallelHits: 0,
  rareModules: 0,
  shieldCharge: 0,
  bossKills: 0,
  rerolls: 0,
  skips: 0,
  weaponSlots: 6,
  hazards: { links: 0, marks: 0, breakpoints: 0, daemons: 0, empowered: 0 },
  player: { x: 0, y: 0 },
  panel: null,
  panelCards: 0,
  zones: 0,
  seed: 0,
  orbs: 0,
  enemies: 0,
  items: 0,
};

export function syncHud(run: RunState, xpNeed: number): void {
  hud.hp = run.hp;
  hud.maxHp = run.stats.maxHp;
  hud.level = run.level;
  hud.xp = run.xp;
  hud.xpNeed = xpNeed;
  hud.time = run.time;
  hud.kills = run.kills;
  hud.gameOver = run.over;
  hud.magnet = run.stats.pickupRadius;
}

type Handler = (payload: any) => void;

export const bus = new (class {
  private handlers = new Map<string, Set<Handler>>();

  on<T>(event: string, fn: (payload: T) => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler);
  }

  off<T>(event: string, fn: (payload: T) => void): void {
    this.handlers.get(event)?.delete(fn as Handler);
  }

  emit(event: string, payload?: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
})();

export const EV = {
  levelUp: 'levelup',
  choicePicked: 'choice:picked',
  choiceAction: 'choice:action',
  banner: 'banner',
  restart: 'restart',
  quit: 'quit',
  togglePause: 'pause:toggle',
  gameOver: 'gameover',
  victory: 'victory',
  endless: 'endless',
  sfxToggle: 'sfx:toggle',
} as const;
