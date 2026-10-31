import { describe, expect, it } from 'vitest';
import { createRun } from '../src/core/state';
import {
  buildRecapDocument,
  buildRunReport,
  formatDamage,
  recapJsonText,
  reportText,
} from '../src/systems/recap';

describe('run recap', () => {
  it('formats damage compactly without rounding small values away', () => {
    expect(formatDamage(0)).toBe('0');
    expect(formatDamage(999)).toBe('999');
    expect(formatDamage(1234)).toBe('1.2k');
    expect(formatDamage(2500000)).toBe('2.5m');
  });

  it('records the complete build including evolution branches and rare modules', () => {
    const run = createRun(4);
    run.weapons.dart = 8;
    run.weapons.ray = 5;
    run.evolutions.dart = 'dart_stack';
    run.passives.cache = 3;
    run.rareModules.focus_transfer = 1;
    const report = buildRunReport(run, true);
    expect(report.build).toContain(';L8/B');
    expect(report.build).toContain('/regex/L5');
    expect(report.build).toContain('>>L3');
    expect(report.build).toContain('焦点转移');
    expect(report.loadout.weapons).toContain(';L8/B');
    expect(report.loadout.rare).toEqual(['焦点转移']);
    expect(report.weaponSlots).toBe(4);
    expect(report.victory).toBe(true);
  });

  it('builds a JSON document with every recap field', () => {
    const run = createRun();
    run.time = 421;
    run.kills = 640;
    run.weapons.dart = 8;
    run.evolutions.dart = 'dart_stack';
    run.summary.damage.dart = 12000;
    run.summary.damage.bomb = 800;
    run.summary.bossDamage.dart = 4200;
    run.summary.cacheActiveTime = 18.25;
    run.summary.parallelBonus = 1200;
    run.summary.gcSweeps = 7;
    run.summary.shieldsBlocked = 3;
    run.summary.overkill = 2100;
    run.summary.events = { accepted: 4, completed: 3, failed: 1, expired: 1 };
    run.summary.lastHit = { source: 'Deadlock link', amount: 14, at: 412 };
    const doc = buildRecapDocument(buildRunReport(run, false));
    expect(doc.result).toBe('TERMINATED');
    expect(doc.run.time).toBe('07:01');
    expect(doc.build.weapons).toEqual([';L8/B']);
    expect(doc.damage.by_weapon[';']).toBe('12.0k');
    expect(doc.damage.by_weapon['!']).toBe('800');
    expect(doc.damage.boss[';']).toBe('4.2k');
    expect(doc.damage.overkill).toBe('2.1k');
    expect(doc.defense.cache).toBe(18.3);
    expect(doc.defense.parallel).toBe('1.2k');
    expect(doc.defense.gc).toBe(7);
    expect(doc.defense.shield).toBe(3);
    expect(doc.events).toEqual({ accepted: 4, completed: 3, failed: 1, expired: 1 });
    expect(doc.last_hit).toEqual({ source: 'Deadlock link', damage: 14, at: '06:52' });
  });

  it('renders valid JSON for the recap viewer and clipboard', () => {
    const run = createRun();
    run.time = 421;
    run.kills = 640;
    run.summary.damage.orbit = 500;
    const report = buildRunReport(run, false);
    const json = recapJsonText(report);
    const parsed = JSON.parse(json) as ReturnType<typeof buildRecapDocument>;
    expect(parsed.result).toBe('TERMINATED');
    expect(parsed.run.kills).toBe(640);
    expect(parsed.damage.by_weapon['()']).toBe('500');
    expect(reportText(report)).toBe(json);
  });
});
