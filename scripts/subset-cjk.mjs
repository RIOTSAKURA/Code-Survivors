import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const SRC = resolve('src');
const OUT_DIR = resolve('src/assets');
const CSS_OUT = join(OUT_DIR, 'cjk.css');
const MANIFEST = join(OUT_DIR, 'cjk-manifest.json');
const FONT = 'Noto Sans SC';
const WEIGHTS = [400, 700];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function collectSources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSources(full)));
    else if (['.ts', '.html', '.css'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

export function cjkCharactersOf(text) {
  const found = new Set();
  for (const char of text) {
    const code = char.codePointAt(0);
    const isCjk =
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3000 && code <= 0x303f);
    if (isCjk) found.add(char);
  }
  return found;
}

async function collectCharacters() {
  const files = [...(await collectSources(SRC)), resolve('index.html')].filter((f) => existsSync(f));
  const chars = new Set();
  for (const file of files) {
    for (const char of cjkCharactersOf(await readFile(file, 'utf-8'))) chars.add(char);
  }
  return [...chars].sort();
}

async function fetchSubset(chars, weight) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(FONT)}:wght@${weight}&text=${encodeURIComponent(chars.join(''))}&display=swap`;
  const css = await fetch(url, { headers: { 'user-agent': UA } }).then((r) => r.text());
  const match = css.match(/src:\s*url\((https:\/\/[^)]+)\)/);
  if (!match) throw new Error(`no woff2 in the ${weight} response:\n${css.slice(0, 400)}`);
  const file = await fetch(match[1]).then((r) => r.arrayBuffer());
  const name = `cjk-${FONT.toLowerCase().replace(/\s+/g, '-')}-${weight}.woff2`;
  await writeFile(join(OUT_DIR, name), Buffer.from(file));
  return { name, bytes: file.byteLength };
}

const chars = await collectCharacters();
await mkdir(OUT_DIR, { recursive: true });
const faces = [];
for (const weight of WEIGHTS) {
  const { name, bytes } = await fetchSubset(chars, weight);
  faces.push(`@font-face {
  font-family: '${FONT}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('./${name}') format('woff2');
}`);
  console.log(`${name}: ${(bytes / 1024).toFixed(1)} kB`);
}
await writeFile(CSS_OUT, faces.join('\n\n') + '\n');
await writeFile(
  MANIFEST,
  JSON.stringify({ font: FONT, weights: WEIGHTS, characters: chars.join(''), count: chars.length }, null, 2) + '\n',
);
console.log(`${chars.length} characters subset into ${CSS_OUT}`);
