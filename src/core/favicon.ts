import { MONO_FONT } from '../config';

const SIZE = 96;
const GLYPH = '</>';

export function renderFavicon(): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.strokeStyle = 'rgba(49,50,68,0.85)';
  ctx.lineWidth = 1;
  for (let i = 12; i < SIZE; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(SIZE, i + 0.5);
    ctx.stroke();
  }

  ctx.font = `bold 40px ${MONO_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00ffff';
  ctx.shadowColor = 'rgba(0,255,255,0.95)';
  ctx.shadowBlur = 9;
  ctx.fillText(GLYPH, SIZE / 2, SIZE / 2 + 1);
  ctx.fillText(GLYPH, SIZE / 2, SIZE / 2 + 1);
  ctx.shadowBlur = 3;
  ctx.fillText(GLYPH, SIZE / 2, SIZE / 2 + 1);
  ctx.shadowBlur = 0;

  return canvas.toDataURL('image/png');
}

export function installFavicon(): void {
  const href = renderFavicon();
  if (!href) return;
  let link = document.querySelector<HTMLLinkElement>('link#favicon');
  if (!link) {
    link = document.createElement('link');
    link.id = 'favicon';
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = href;
}
