import { PALETTE, TERRAIN, WORLD } from '../config';
import { Rng } from '../core/rng';

export type ZoneKind = 'include' | 'pragma' | 'leak' | 'crash';
export type DecorKind = 'comment' | 'diff' | 'region' | 'patch';

export interface ZoneDef {
  kind: ZoneKind;
  name: string;
  label: string;
  color: number;
  good: boolean;
  desc: string;
}

export const ZONE_DEFS: Record<ZoneKind, ZoneDef> = {
  include: {
    kind: 'include',
    name: '编译缓存',
    label: '#include',
    color: PALETTE.green,
    good: true,
    desc: '圈内攻速 +20%，缓存随停留耗尽，耗尽后区域直接消散（离场可回充）',
  },
  pragma: {
    kind: 'pragma',
    name: '指令加速',
    label: '#pragma',
    color: PALETTE.cyan,
    good: true,
    desc: '圈内移速 +25%，同样随停留耗尽，耗尽后区域直接消散（离场可回充）',
  },
  leak: {
    kind: 'leak',
    name: '内存泄漏池',
    label: '/*leak*/',
    color: PALETTE.orange,
    good: false,
    desc: '圈内敌我移速 -28%：能拖住虫群，但你也会被拖住',
  },
  crash: {
    kind: 'crash',
    name: '崩溃陨坑',
    label: 'FIXME',
    color: PALETTE.red,
    good: false,
    desc: '圈内敌我持续掉血（玩家 5/秒，敌人 20/秒）；陨坑里的击杀不产生掉落，适合把虫群引进去清理',
  },
};

export const ZONE_KINDS: ZoneKind[] = ['include', 'pragma', 'leak', 'crash'];
export const DECOR_KINDS: DecorKind[] = ['comment', 'diff', 'region', 'patch'];

export interface TerrainZone {
  id: number;
  kind: ZoneKind;
  x: number;
  y: number;
  radius: number;
  charge: number;
}

export interface TerrainDecor {
  kind: DecorKind;
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
}

const DECOR_WEIGHTS: Array<[DecorKind, number]> = [
  ['comment', 0.2],
  ['diff', 0.3],
  ['region', 0.2],
  ['patch', 0.3],
];

function pickDecor(rng: Rng): DecorKind {
  let roll = rng.next();
  for (const [kind, weight] of DECOR_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return 'patch';
}

export type EventKind = 'compile' | 'packet' | 'commit';

export interface PacketFragment {
  x: number;
  y: number;
  got: boolean;
  guards: number[];
}

export interface TerrainEvent {
  id: number;
  kind: EventKind;
  charge: number;
  done: boolean;
  deadline: number;
  engaged: boolean;
  fragments: PacketFragment[];
  kills: number;
  need: number;
}

export const TERRAIN_EVENTS: Record<
  EventKind,
  { label: string; name: string; color: number; desc: string }
> = {
  compile: {
    label: '#compile',
    name: '编译节点',
    color: PALETTE.yellow,
    desc: '出现后按 E 接受编译任务：完成后获得一次免费模块选择，编译期间攻速降低、受伤提高并持续吸引敌人',
  },
  packet: {
    label: '#packet',
    name: '损坏的数据包',
    color: PALETTE.cyan,
    desc: '出现后按 E 接受数据包任务，跑向散落在附近的 3 块碎片；靠近碎片会刷出守卫，清掉守卫才能拾取，全部收齐可获得一次武器进化机会；超时则数据包丢失',
  },
  commit: {
    label: '#commit',
    name: '危险提交',
    color: PALETTE.red,
    desc: '出现后按 E 接受强化波次：在限定时间内击杀足够多的强化敌人，完成后获得稀有模块',
  },
};

export const TERRAIN_EVENT = TERRAIN_EVENTS.compile;

export interface Terrain {
  seed: number;
  zones: TerrainZone[];
  decor: TerrainDecor[];
}

function circleHitsRect(cx: number, cy: number, radius: number, x: number, y: number, w: number, h: number): boolean {
  const nx = Math.min(Math.max(cx, x), x + w);
  const ny = Math.min(Math.max(cy, y), y + h);
  return Math.hypot(cx - nx, cy - ny) < radius + TERRAIN.towerMargin;
}

export function reshuffleZones(
  seed: number,
  zones: TerrainZone[],
  world = WORLD,
  avoid: { x: number; y: number; radius: number } = { x: -1e6, y: -1e6, radius: 0 },
): TerrainZone[] {
  const rng = new Rng(seed >>> 0 || 1);
  const opening = rng.shuffle([...ZONE_KINDS]);
  const next: TerrainZone[] = [];

  for (let i = 0; i < zones.length; i++) {
    const kind = i < opening.length ? opening[i] : rng.pick(ZONE_KINDS);
    const radius = rng.range(TERRAIN.zoneRadiusMin, TERRAIN.zoneRadiusMax);
    let placed = false;
    for (let attempt = 0; attempt < 400 && !placed; attempt++) {
      const x = rng.range(TERRAIN.zoneMargin, world.width - TERRAIN.zoneMargin);
      const y = rng.range(TERRAIN.zoneMargin, world.height - TERRAIN.zoneMargin);
      if (Math.hypot(x - avoid.x, y - avoid.y) < radius + avoid.radius + TERRAIN.zonePlayerGap) {
        continue;
      }
      const spread = attempt < 300 ? TERRAIN.zoneSpreadMin : 0;
      const crowded = next.some(
        (zone) => Math.hypot(zone.x - x, zone.y - y) < zone.radius + radius + spread,
      );
      if (crowded) continue;
      next.push({ id: zones[i].id, kind, x, y, radius, charge: 1 });
      placed = true;
    }
    if (!placed) next.push({ ...zones[i], charge: 1 });
  }

  return next;
}

export function generateTerrain(seed: number, world = WORLD): Terrain {
  const rng = new Rng(seed >>> 0 || 1);
  const centreX = world.width / 2;
  const centreY = world.height / 2;
  const zones: TerrainZone[] = [];
  const opening = rng.shuffle([...ZONE_KINDS]);

  for (let i = 0; i < TERRAIN.zoneCount; i++) {
    const kind = i < opening.length ? opening[i] : rng.pick(ZONE_KINDS);
    const radius = rng.range(TERRAIN.zoneRadiusMin, TERRAIN.zoneRadiusMax);
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = rng.range(TERRAIN.zoneMargin, world.width - TERRAIN.zoneMargin);
      const y = rng.range(TERRAIN.zoneMargin, world.height - TERRAIN.zoneMargin);
      if (kind === 'crash' && Math.hypot(x - centreX, y - centreY) < TERRAIN.startSafeRadius + radius) {
        continue;
      }
      const crowded = zones.some(
        (zone) => Math.hypot(zone.x - x, zone.y - y) < zone.radius + radius + TERRAIN.zoneSpreadMin,
      );
      if (crowded) continue;
      zones.push({ id: i, kind, x, y, radius, charge: 1 });
      break;
    }
  }

  const decor: TerrainDecor[] = [];
  for (let attempt = 0; attempt < TERRAIN.decorCount * 6 && decor.length < TERRAIN.decorCount; attempt++) {
    const kind = pickDecor(rng);
    const w =
      kind === 'region' ? rng.range(620, 1500) : kind === 'comment' ? rng.range(220, 540) : rng.range(180, 760);
    const h =
      kind === 'region' ? rng.range(120, 260) : kind === 'comment' ? rng.range(120, 340) : rng.range(10, 20);
    const x = rng.range(0, world.width - w);
    const y = rng.range(0, world.height - h);
    const clashes = zones.some((zone) => circleHitsRect(zone.x, zone.y, zone.radius, x, y, w, h));
    if (clashes) continue;
    decor.push({ kind, x, y, w, h, seed: Math.floor(rng.next() * 0xffffff) });
  }

  return { seed, zones, decor };
}
