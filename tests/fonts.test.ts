import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CJK_RANGES: Array<[number, number]> = [
  [0x2e80, 0x9fff],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
  [0x3000, 0x303f],
];

function isCjk(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return CJK_RANGES.some(([from, to]) => code >= from && code <= to);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return full.includes('assets') ? [] : walk(full);
    return /\.(ts|css|html)$/.test(entry.name) ? [full] : [];
  });
}

describe('bundled fonts', () => {
  it('covers every CJK glyph the UI renders', () => {
    const manifest = JSON.parse(readFileSync('src/assets/cjk-manifest.json', 'utf-8')) as {
      characters: string;
      weights: number[];
    };
    const covered = new Set(manifest.characters);
    const missing = new Set<string>();
    for (const file of [...walk('src'), 'index.html']) {
      for (const char of readFileSync(file, 'utf-8')) {
        if (isCjk(char) && !covered.has(char)) missing.add(char);
      }
    }
    expect(
      [...missing].join(''),
      'new CJK text is not in the bundled subset - run `npm run font:subset`',
    ).toBe('');
  });

  it('ships both weights and a generated stylesheet', () => {
    const manifest = JSON.parse(readFileSync('src/assets/cjk-manifest.json', 'utf-8')) as {
      font: string;
      weights: number[];
      count: number;
    };
    expect(manifest.font).toBe('Noto Sans SC');
    expect(manifest.weights).toEqual([400, 700]);
    expect(manifest.count).toBeGreaterThan(100);
    const css = readFileSync('src/assets/cjk.css', 'utf-8');
    for (const weight of manifest.weights) {
      expect(css).toContain(`font-weight: ${weight};`);
    }
    expect(css).toContain('format(\'woff2\')');
  });

  it('pairs the monospace font with the CJK fallback in that order', () => {
    const config = readFileSync('src/config.ts', 'utf-8');
    const first = config.indexOf('"JetBrains Mono"');
    const second = config.indexOf('"Noto Sans SC"');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });
});
