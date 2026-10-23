import type { RunState, Stats } from './types';

export function createStats(): Stats {
  return {
    maxHp: 100,
    speed: 200,
    pickupRadius: 68,
    armor: 0,
    damageMult: 1,
    cooldownMult: 1,
    projectileBonus: 0,
    splitChance: 0,
  };
}

export function createRun(): RunState {
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
    pendingLevels: 0,
    over: false,
  };
}

export interface HudEntry {
  symbol: string;
  level: number;
  color: number;
  max: boolean;
}

export interface BossHud {
  name: string;
  hp: number;
  maxHp: number;
  phase: number;
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
  paused: boolean;
  damageFlash: number;
  magnet: number;
  boss: BossHud | null;
  choices: number;
  orbs: number;
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
  paused: false,
  damageFlash: 0,
  magnet: 68,
  boss: null,
  choices: 0,
  orbs: 0,
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
  banner: 'banner',
  restart: 'restart',
  quit: 'quit',
  togglePause: 'pause:toggle',
  gameOver: 'gameover',
  sfxToggle: 'sfx:toggle',
} as const;
