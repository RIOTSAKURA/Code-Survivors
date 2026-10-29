import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const SIZE = 1024;
const INSET = 92;
const RADIUS = 190;
const CONTENT = SIZE - INSET * 2;
const UNIT = CONTENT / 96;
const BACKGROUND = [30, 30, 46];
const GRID = [49, 50, 68];
const CYAN = [0, 255, 255];
const STROKE = 1.75 * UNIT;
const GLOW = 5 * UNIT;
const SEGMENTS = [
  [31, 33, 15, 48],
  [15, 48, 31, 63],
  [42, 62, 55, 31],
  [62, 33, 79, 48],
  [79, 48, 62, 63],
].map(([x1, y1, x2, y2]) => [
  INSET + x1 * UNIT,
  INSET + y1 * UNIT,
  INSET + x2 * UNIT,
  INSET + y2 * UNIT,
]);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, crc]);
};

const segmentDistance = (x, y, [x1, y1, x2, y2]) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};

const roundedRect = (x, y) => {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const half = CONTENT / 2;
  const qx = Math.abs(x - cx) - (half - RADIUS);
  const qy = Math.abs(y - cy) - (half - RADIUS);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RADIUS;
};

const gridLines = Array.from({ length: 7 }, (_, i) => INSET + (i + 1) * 12 * UNIT);

const blend = (target, source, alpha) => {
  if (alpha <= 0) return;
  target[0] += (source[0] - target[0]) * alpha;
  target[1] += (source[1] - target[1]) * alpha;
  target[2] += (source[2] - target[2]) * alpha;
};

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  for (let x = 0; x < SIZE; x++) {
    const coverage = Math.max(0, Math.min(1, 0.5 - roundedRect(x + 0.5, y + 0.5)));
    const offset = row + 1 + x * 4;
    if (coverage === 0) continue;
    const color = [...BACKGROUND];
    const lineAlpha = Math.max(0, Math.min(1, UNIT / 2 + 0.5 - Math.min(
      ...gridLines.map((line) => Math.min(Math.abs(x + 0.5 - line), Math.abs(y + 0.5 - line))),
    )));
    blend(color, GRID, lineAlpha * 0.85);
    const distance = Math.min(...SEGMENTS.map(
      (segment) => segmentDistance(x + 0.5, y + 0.5, segment),
    ));
    blend(color, CYAN, 0.95 * Math.exp(-((distance / GLOW) ** 2)));
    blend(color, CYAN, Math.max(0, Math.min(1, STROKE + 0.5 - distance)));
    raw[offset] = Math.round(color[0]);
    raw[offset + 1] = Math.round(color[1]);
    raw[offset + 2] = Math.round(color[2]);
    raw[offset + 3] = Math.round(coverage * 255);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

await mkdir('build', { recursive: true });
await writeFile('build/icon.png', png);
console.log(`wrote build/icon.png (${png.length} bytes)`);
