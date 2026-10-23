import { describe, expect, it } from 'vitest';
import { SpatialGrid, findNearest, findNearestMany } from '../src/core/grid';

interface Node {
  x: number;
  y: number;
  id: number;
}

function make(x: number, y: number, id: number): Node {
  return { x, y, id };
}

describe('SpatialGrid', () => {
  it('returns items inside the query radius', () => {
    const grid = new SpatialGrid<Node>(64);
    const near = make(10, 10, 1);
    const far = make(5000, 5000, 2);
    grid.rebuild([near, far]);

    const out = grid.query(0, 0, 100, []);
    expect(out).toContain(near);
    expect(out).not.toContain(far);
  });

  it('rebuild clears previous content', () => {
    const grid = new SpatialGrid<Node>(64);
    grid.rebuild([make(0, 0, 1)]);
    grid.rebuild([make(0, 0, 2)]);
    const out = grid.query(0, 0, 50, []);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
  });

  it('finds the nearest item within range', () => {
    const grid = new SpatialGrid<Node>(64);
    const a = make(30, 0, 1);
    const b = make(12, 0, 2);
    const c = make(4000, 4000, 3);
    grid.rebuild([a, b, c]);
    expect(findNearest(grid, 0, 0, 1000)?.id).toBe(2);
  });

  it('respects max distance', () => {
    const grid = new SpatialGrid<Node>(64);
    grid.rebuild([make(900, 0, 1)]);
    expect(findNearest(grid, 0, 0, 100)).toBeNull();
  });

  it('returns the requested number of nearest items sorted by distance', () => {
    const grid = new SpatialGrid<Node>(64);
    grid.rebuild([make(300, 0, 3), make(100, 0, 1), make(200, 0, 2), make(900, 0, 4)]);
    const out = findNearestMany(grid, 0, 0, 1000, 3, []);
    expect(out.map((n) => n.id)).toEqual([1, 2, 3]);
  });

  it('does not leak items across distant cells', () => {
    const grid = new SpatialGrid<Node>(64);
    const items = Array.from({ length: 40 }, (_, i) => make(i * 40, i * 40, i));
    grid.rebuild(items);
    const out = grid.query(20, 20, 70, []);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(items.length);
  });
});
