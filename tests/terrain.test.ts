import { describe, expect, it } from 'vitest';
import { TERRAIN, WORLD } from '../src/config';
import {
  DECOR_KINDS,
  ZONE_DEFS,
  ZONE_KINDS,
  generateTerrain,
  reshuffleZones,
} from '../src/data/terrain';
import { isZoneSpent, stepCharge, zoneHazard, zoneMods } from '../src/systems/terrain';

const terrain = generateTerrain(20240601);

describe('terrain generation', () => {
  it('is deterministic for a seed and different across seeds', () => {
    expect(generateTerrain(20240601)).toEqual(terrain);
    const other = generateTerrain(20240602);
    expect(other.seed).toBe(20240602);
    expect(JSON.stringify(other.zones)).not.toBe(JSON.stringify(terrain.zones));
  });

  it('lays out the configured number of zones inside the world', () => {
    expect(terrain.zones).toHaveLength(TERRAIN.zoneCount);
    for (const zone of terrain.zones) {
      expect(zone.radius).toBeGreaterThanOrEqual(TERRAIN.zoneRadiusMin);
      expect(zone.radius).toBeLessThanOrEqual(TERRAIN.zoneRadiusMax);
      expect(zone.x - zone.radius).toBeGreaterThanOrEqual(0);
      expect(zone.y - zone.radius).toBeGreaterThanOrEqual(0);
      expect(zone.x + zone.radius).toBeLessThanOrEqual(WORLD.width);
      expect(zone.y + zone.radius).toBeLessThanOrEqual(WORLD.height);
      expect(zone.charge).toBe(1);
    }
  });

  it('never overlaps two zones', () => {
    for (let i = 0; i < terrain.zones.length; i++) {
      for (let j = i + 1; j < terrain.zones.length; j++) {
        const a = terrain.zones[i];
        const b = terrain.zones[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it('puts one of every kind on the map', () => {
    const kinds = new Set(terrain.zones.map((zone) => zone.kind));
    for (const kind of ZONE_KINDS) expect(kinds.has(kind)).toBe(true);
  });

  it('keeps hazards away from the spawn point', () => {
    for (const zone of terrain.zones) {
      if (zone.kind !== 'crash') continue;
      const distance = Math.hypot(zone.x - WORLD.width / 2, zone.y - WORLD.height / 2);
      expect(distance).toBeGreaterThanOrEqual(TERRAIN.startSafeRadius);
    }
  });

  it('mixes decor kinds instead of drowning the map in comment blocks', () => {
    const counts = new Map<string, number>();
    for (const piece of terrain.decor) {
      counts.set(piece.kind, (counts.get(piece.kind) ?? 0) + 1);
    }
    for (const kind of DECOR_KINDS) expect(counts.get(kind) ?? 0).toBeGreaterThan(0);
    const comments = counts.get('comment') ?? 0;
    expect(comments / terrain.decor.length).toBeLessThan(0.4);
    for (const piece of terrain.decor) {
      expect(Number.isInteger(piece.seed)).toBe(true);
      expect(piece.seed).toBeGreaterThanOrEqual(0);
    }
  });

  it('scatters decor without burying the zones', () => {
    expect(terrain.decor.length).toBeGreaterThan(TERRAIN.decorCount * 0.6);
    for (const piece of terrain.decor) {
      expect(piece.x).toBeGreaterThanOrEqual(0);
      expect(piece.y).toBeGreaterThanOrEqual(0);
      expect(piece.x + piece.w).toBeLessThanOrEqual(WORLD.width);
      expect(piece.y + piece.h).toBeLessThanOrEqual(WORLD.height);
      for (const zone of terrain.zones) {
        const nearestX = Math.min(Math.max(zone.x, piece.x), piece.x + piece.w);
        const nearestY = Math.min(Math.max(zone.y, piece.y), piece.y + piece.h);
        expect(Math.hypot(zone.x - nearestX, zone.y - nearestY)).toBeGreaterThan(zone.radius);
      }
    }
  });
});

describe('zone reshuffle', () => {
  const avoid = { x: WORLD.width / 2, y: WORLD.height / 2, radius: 15 };
  const moved = reshuffleZones(99887766, terrain.zones, WORLD, avoid);

  it('keeps the zone count and hands out a full set of kinds', () => {
    expect(moved).toHaveLength(terrain.zones.length);
    const kinds = new Set(moved.map((zone) => zone.kind));
    for (const kind of ZONE_KINDS) expect(kinds.has(kind)).toBe(true);
  });

  it('actually relocates them', () => {
    const before = terrain.zones.map((zone) => `${zone.x},${zone.y}`).join('|');
    const after = moved.map((zone) => `${zone.x},${zone.y}`).join('|');
    expect(after).not.toBe(before);
  });

  it('keeps zones in bounds, apart from each other, and off the player', () => {
    for (const zone of moved) {
      expect(zone.x - zone.radius).toBeGreaterThanOrEqual(0);
      expect(zone.y - zone.radius).toBeGreaterThanOrEqual(0);
      expect(zone.x + zone.radius).toBeLessThanOrEqual(WORLD.width);
      expect(zone.y + zone.radius).toBeLessThanOrEqual(WORLD.height);
      expect(Math.hypot(zone.x - avoid.x, zone.y - avoid.y)).toBeGreaterThan(
        zone.radius + avoid.radius + TERRAIN.zonePlayerGap - 1,
      );
      expect(zone.charge).toBe(1);
    }
    for (let i = 0; i < moved.length; i++) {
      for (let j = i + 1; j < moved.length; j++) {
        const a = moved[i];
        const b = moved[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it('is reproducible from its seed', () => {
    expect(reshuffleZones(99887766, terrain.zones, WORLD, avoid)).toEqual(moved);
  });
});

describe('terrain effects', () => {
  it('buffs scale with the remaining charge', () => {
    expect(zoneMods('include', 1).cooldown).toBeCloseTo(1 - TERRAIN.effects.includeCooldown, 6);
    expect(zoneMods('include', 0.5).cooldown).toBeCloseTo(1 - TERRAIN.effects.includeCooldown / 2, 6);
    expect(zoneMods('include', 0).cooldown).toBe(1);
    expect(zoneMods('pragma', 1).speed).toBeCloseTo(1 + TERRAIN.effects.pragmaSpeed, 6);
    expect(zoneMods('pragma', 0).speed).toBe(1);
  });

  it('risks are flat and never boost the player', () => {
    expect(zoneMods('leak', 1).speed).toBeCloseTo(TERRAIN.effects.leakSpeed, 6);
    expect(zoneMods('leak', 1).speed).toBeLessThan(1);
    expect(zoneMods('crash', 1)).toEqual({ speed: 1, cooldown: 1 });
    expect(zoneMods(null, 1)).toEqual({ speed: 1, cooldown: 1 });
  });

  it('drains charge while inside and refills outside', () => {
    let charge = 1;
    for (let i = 0; i < 100; i++) charge = stepCharge(true, charge, 0.1);
    expect(charge).toBeCloseTo(1 - 10 / TERRAIN.charge.sustain, 5);
    for (let i = 0; i < 200; i++) charge = stepCharge(false, charge, 0.1);
    expect(charge).toBe(1);
    expect(stepCharge(true, 0, 5)).toBe(0);
    expect(stepCharge(false, 1, 5)).toBe(1);
  });

  it('never resurrects a zone that ran dry', () => {
    let charge = 0;
    for (let i = 0; i < 500; i++) charge = stepCharge(false, charge, 0.1);
    expect(charge).toBe(0);
    expect(isZoneSpent('include', charge)).toBe(true);
    let partial = 0.4;
    for (let i = 0; i < 20; i++) partial = stepCharge(false, partial, 0.1);
    expect(partial).toBeGreaterThan(0.4);
  });

  it('retires a buff zone once its charge is gone', () => {
    expect(isZoneSpent('include', 0)).toBe(true);
    expect(isZoneSpent('pragma', 0)).toBe(true);
    expect(isZoneSpent('include', 0.01)).toBe(false);
    expect(isZoneSpent('leak', 0)).toBe(false);
    expect(isZoneSpent('crash', 0)).toBe(false);
    let charge = 1;
    for (let i = 0; i < 100 && !isZoneSpent('pragma', charge); i++) {
      charge = stepCharge(true, charge, 0.2);
    }
    expect(isZoneSpent('pragma', charge)).toBe(true);
  });

  it('only the crash site hurts anything', () => {
    expect(zoneHazard('crash')).toEqual({
      playerDps: TERRAIN.effects.crashPlayerDps,
      enemyDps: TERRAIN.effects.crashEnemyDps,
    });
    for (const kind of ZONE_KINDS) {
      if (kind === 'crash') continue;
      expect(zoneHazard(kind)).toEqual({ playerDps: 0, enemyDps: 0 });
    }
  });

  it('describes every zone for the codex', () => {
    for (const kind of ZONE_KINDS) {
      const def = ZONE_DEFS[kind];
      expect(def.label.length).toBeGreaterThan(2);
      expect(def.desc.length).toBeGreaterThan(8);
      expect(def.name.length).toBeGreaterThan(0);
    }
  });
});
