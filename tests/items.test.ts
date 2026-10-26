import { describe, expect, it } from 'vitest';
import { ITEM } from '../src/config';
import { ITEM_DEFS, ITEM_IDS, itemDropChance, pickItemDrop, totalItemChance } from '../src/data/items';

describe('dropped items', () => {
  it('ships three distinct pickups with a name, glyph and colour of their own', () => {
    expect(ITEM_IDS).toHaveLength(3);
    expect(new Set(ITEM_IDS).size).toBe(3);
    const glyphs = ITEM_IDS.map((id) => ITEM_DEFS[id].glyph);
    expect(new Set(glyphs).size).toBe(3);
    const colors = ITEM_IDS.map((id) => ITEM_DEFS[id].color);
    expect(new Set(colors).size).toBe(3);
    for (const id of ITEM_IDS) {
      const def = ITEM_DEFS[id];
      expect(def.name.length).toBeGreaterThan(1);
      expect(def.tagline.length).toBeGreaterThan(2);
      expect(def.desc.length).toBeGreaterThan(8);
      expect(def.detail.length).toBeGreaterThan(2);
      expect(itemDropChance(id)).toBeGreaterThan(0);
    }
  });

  it('drops rarely, so a run is not swimming in them', () => {
    for (const id of ITEM_IDS) {
      const chance = itemDropChance(id);
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThan(0.02);
    }
    expect(totalItemChance()).toBeCloseTo(
      ITEM_IDS.reduce((sum, id) => sum + ITEM.rate[id], 0),
      9,
    );
    expect(totalItemChance()).toBeLessThan(0.03);
  });

  it('keeps the heal most common, the field wipe rarest', () => {
    expect(itemDropChance('hotfix')).toBeGreaterThan(itemDropChance('fetch'));
    expect(itemDropChance('fetch')).toBeGreaterThan(itemDropChance('sigkill'));
    expect(itemDropChance('hotfix')).toBeLessThan(0.02);
    expect(itemDropChance('sigkill')).toBeGreaterThan(0);
  });

  it('never drops anything above the configured chance', () => {
    for (let roll = totalItemChance(); roll < 1; roll += 0.037) {
      expect(pickItemDrop(roll)).toBeNull();
    }
  });

  it('covers the whole drop window and is monotone by weight', () => {
    const seen = new Set<string>();
    const window = totalItemChance();
    for (let roll = 0; roll < window; roll += window / 500) {
      const id = pickItemDrop(roll);
      expect(id).not.toBeNull();
      seen.add(id!);
    }
    for (const id of ITEM_IDS) expect(seen.has(id)).toBe(true);
    const ordered = [...ITEM_IDS].sort((a, b) => itemDropChance(b) - itemDropChance(a));
    const shares = ordered.map((id) => itemDropChance(id));
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThanOrEqual(shares[i - 1]);
  });

  it('keeps every effect meaningful', () => {
    expect(ITEM.heal).toBeGreaterThanOrEqual(20);
    expect(ITEM.empBossPct).toBeGreaterThan(0.05);
    expect(ITEM.empBossPct).toBeLessThan(0.4);
    expect(ITEM.grabRadius).toBeGreaterThan(20);
    expect(ITEM.lifetime).toBeGreaterThan(10);
  });
});
