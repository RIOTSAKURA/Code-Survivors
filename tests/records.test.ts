import { beforeEach, describe, expect, it } from 'vitest';
import { readBest, writeBest, formatTime } from '../src/core/records';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

describe('best run record', () => {
  it('starts empty and keeps a first run', () => {
    expect(readBest()).toBeNull();
    expect(writeBest({ time: 32.5, kills: 40, level: 6 })).toBe(true);
    expect(readBest()).toEqual({ time: 32.5, kills: 40, level: 6 });
  });

  it('keeps the better run no matter which one is written last', () => {
    writeBest({ time: 60, kills: 90, level: 9 });
    expect(writeBest({ time: 30, kills: 200, level: 12 })).toBe(false);
    expect(readBest()?.time).toBe(60);
    expect(writeBest({ time: 90, kills: 10, level: 3 })).toBe(true);
    expect(readBest()).toEqual({ time: 90, kills: 10, level: 3 });
  });

  it('treats an equal time as not an improvement', () => {
    writeBest({ time: 45, kills: 10, level: 4 });
    expect(writeBest({ time: 45, kills: 999, level: 30 })).toBe(false);
    expect(readBest()?.kills).toBe(10);
  });

  it('survives a corrupt or partial payload', () => {
    localStorage.setItem('code-survivors:best', 'not json');
    expect(readBest()).toBeNull();
    localStorage.setItem('code-survivors:best', JSON.stringify({ kills: 5 }));
    expect(readBest()).toBeNull();
    localStorage.setItem('code-survivors:best', JSON.stringify({ time: 12 }));
    expect(readBest()).toEqual({ time: 12, kills: 0, level: 1 });
  });

  it('formats the clock the way the hud and menu do', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(9.9)).toBe('00:09');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(600)).toBe('10:00');
  });
});
