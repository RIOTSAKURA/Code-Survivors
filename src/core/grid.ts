export interface GridItem {
  x: number;
  y: number;
}

const OFFSET = 1 << 15;

export class SpatialGrid<T extends GridItem> {
  private readonly cells = new Map<number, T[]>();

  constructor(readonly cellSize: number) {}

  private key(cx: number, cy: number): number {
    return (cx + OFFSET) * 65536 + (cy + OFFSET);
  }

  clear(): void {
    this.cells.clear();
  }

  insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const key = this.key(cx, cy);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(item);
    else this.cells.set(key, [item]);
  }

  rebuild(items: readonly T[]): void {
    this.clear();
    for (let i = 0; i < items.length; i++) this.insert(items[i]);
  }

  query(x: number, y: number, radius: number, out: T[]): T[] {
    out.length = 0;
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}

export function findNearest<T extends GridItem>(
  grid: SpatialGrid<T>,
  x: number,
  y: number,
  maxDist: number,
  filter?: (item: T) => boolean,
): T | null {
  let best: T | null = null;
  let bestDist = maxDist * maxDist;
  const candidates: T[] = [];
  grid.query(x, y, maxDist, candidates);
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (filter && !filter(item)) continue;
    const dx = item.x - x;
    const dy = item.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best;
}

export function findNearestMany<T extends GridItem>(
  grid: SpatialGrid<T>,
  x: number,
  y: number,
  maxDist: number,
  count: number,
  out: T[],
): T[] {
  out.length = 0;
  const candidates: T[] = [];
  grid.query(x, y, maxDist, candidates);
  candidates.sort((a, b) => {
    const da = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
    const db = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
    return da - db;
  });
  for (let i = 0; i < candidates.length && out.length < count; i++) out.push(candidates[i]);
  return out;
}
