import { formatTime } from '../core/records';
import { EVOLUTION_DEFS } from '../data/evolutions';
import { PASSIVE_DEFS, PASSIVE_IDS } from '../data/passives';
import { RARE_MODULES } from '../data/rewards';
import { WEAPON_DEFS, WEAPON_IDS } from '../data/weapons';
import type { DamageSource, RareModuleId, RunState } from '../core/types';
import type { RunReport } from '../core/state';

export function formatDamage(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function damageSourceLabel(source: DamageSource): string {
  if (WEAPON_IDS.includes(source as never)) {
    return WEAPON_DEFS[source as keyof typeof WEAPON_DEFS].symbol;
  }
  if (source === 'gc') return '{}';
  if (source === 'reflect') return '()<';
  if (source === 'terrain') return 'zone';
  if (source === 'event') return 'objective';
  return 'other';
}

function sourceTable(damage: Partial<Record<DamageSource, number>>): Record<string, string> {
  const table: Record<string, string> = {};
  for (const [source, value] of Object.entries(damage)) {
    if ((value ?? 0) <= 0) continue;
    table[damageSourceLabel(source as DamageSource)] = formatDamage(value ?? 0);
  }
  return table;
}

export function loadoutParts(run: RunState): {
  weapons: string[];
  passives: string[];
  rare: string[];
} {
  const weapons = WEAPON_IDS.filter((id) => (run.weapons[id] ?? 0) > 0).map((id) => {
    const level = run.weapons[id] ?? 0;
    const evolution = run.evolutions[id];
    const branch = evolution ? `/${EVOLUTION_DEFS[evolution].branch}` : '';
    return `${WEAPON_DEFS[id].symbol}L${level}${branch}`;
  });
  const passives = PASSIVE_IDS.filter((id) => (run.passives[id] ?? 0) > 0).map(
    (id) => `${PASSIVE_DEFS[id].symbol}L${run.passives[id]}`,
  );
  const rare = RARE_MODULES.filter(
    (module) => (run.rareModules[module.id as RareModuleId] ?? 0) > 0,
  ).map((module) => module.name);
  return { weapons, passives, rare };
}

export function buildLoadout(run: RunState): string {
  const { weapons, passives, rare } = loadoutParts(run);
  const parts: string[] = [];
  if (weapons.length > 0) parts.push(`weapons  ${weapons.join('  ')}`);
  if (passives.length > 0) parts.push(`passive  ${passives.join('  ')}`);
  if (rare.length > 0) parts.push(`rare     ${rare.join('  ')}`);
  const stats = run.stats;
  parts.push(
    `stats    dmg x${stats.damageMult.toFixed(2)}   cd x${stats.cooldownMult.toFixed(2)}   armor ${stats.armor}   speed ${Math.round(stats.speed)}`,
  );
  return parts.join('\n');
}

export function buildRunReport(run: RunState, victory: boolean): RunReport {
  const loadout = loadoutParts(run);
  return {
    time: run.time,
    kills: run.kills,
    level: run.level,
    weapons: Object.keys(run.weapons).length,
    weaponSlots: run.weaponSlots,
    bossKills: run.bossKills,
    build: buildLoadout(run),
    loadout,
    stats: {
      damageMult: Number(run.stats.damageMult.toFixed(2)),
      cooldownMult: Number(run.stats.cooldownMult.toFixed(2)),
      armor: run.stats.armor,
      speed: Math.round(run.stats.speed),
    },
    summary: run.summary,
    victory,
  };
}

export interface RecapDocument {
  result: 'SHIPPED' | 'TERMINATED';
  run: {
    time: string;
    kills: number;
    level: number;
    bosses: number;
    modules: string;
  };
  build: {
    weapons: string[];
    passives: string[];
    rare: string[];
    stats: {
      damage_mult: number;
      cooldown_mult: number;
      armor: number;
      speed: number;
    };
  };
  damage: {
    by_weapon: Record<string, string>;
    boss: Record<string, string>;
    overkill: string;
  };
  defense: {
    cache: number;
    parallel: string;
    gc: number;
    shield: number;
  };
  events: { accepted: number; completed: number; failed: number; expired: number };
  last_hit: { source: string; damage: number; at: string } | null;
}

export function buildRecapDocument(report: RunReport): RecapDocument {
  return {
    result: report.victory ? 'SHIPPED' : 'TERMINATED',
    run: {
      time: formatTime(report.time),
      kills: report.kills,
      level: report.level,
      bosses: report.bossKills,
      modules: `${Math.min(report.weapons, report.weaponSlots)}/${report.weaponSlots}`,
    },
    build: {
      weapons: report.loadout.weapons,
      passives: report.loadout.passives,
      rare: report.loadout.rare,
      stats: {
        damage_mult: report.stats.damageMult,
        cooldown_mult: report.stats.cooldownMult,
        armor: report.stats.armor,
        speed: report.stats.speed,
      },
    },
    damage: {
      by_weapon: sourceTable(report.summary.damage),
      boss: sourceTable(report.summary.bossDamage),
      overkill: formatDamage(report.summary.overkill),
    },
    defense: {
      cache: Number(report.summary.cacheActiveTime.toFixed(1)),
      parallel: formatDamage(report.summary.parallelBonus),
      gc: report.summary.gcSweeps,
      shield: report.summary.shieldsBlocked,
    },
    events: {
      accepted: report.summary.events.accepted,
      completed: report.summary.events.completed,
      failed: report.summary.events.failed,
      expired: report.summary.events.expired,
    },
    last_hit: report.summary.lastHit
      ? {
          source: report.summary.lastHit.source,
          damage: Math.round(report.summary.lastHit.amount),
          at: formatTime(report.summary.lastHit.at),
        }
      : null,
  };
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function compactJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(compactJson).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const body = Object.entries(value)
      .map(([key, child]) => `${JSON.stringify(key)}: ${compactJson(child)}`)
      .join(', ');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

function formatJson(value: JsonValue, indent: number, maxWidth: number): string[] {
  const pad = '  '.repeat(indent);
  const inline = compactJson(value);
  const composite = value !== null && typeof value === 'object';
  if (!composite || pad.length + inline.length <= maxWidth) return [pad + inline];
  if (Array.isArray(value)) {
    const lines = [`${pad}[`];
    value.forEach((child, index) => {
      const block = formatJson(child, indent + 1, maxWidth);
      if (index < value.length - 1) block[block.length - 1] += ',';
      lines.push(...block);
    });
    lines.push(`${pad}]`);
    return lines;
  }
  const entries = Object.entries(value);
  const lines = [`${pad}{`];
  entries.forEach(([key, child], index) => {
    const prefix = `${'  '.repeat(indent + 1)}${JSON.stringify(key)}: `;
    const block = formatJson(child as JsonValue, indent + 1, maxWidth);
    block[0] = prefix + block[0].slice('  '.repeat(indent + 1).length);
    if (index < entries.length - 1) block[block.length - 1] += ',';
    lines.push(...block);
  });
  lines.push(`${pad}}`);
  return lines;
}

export function recapJsonText(report: RunReport): string {
  return formatJson(buildRecapDocument(report) as unknown as JsonValue, 0, 96).join('\n');
}

export function reportText(report: RunReport): string {
  return recapJsonText(report);
}
