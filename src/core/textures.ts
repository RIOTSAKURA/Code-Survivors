import Phaser from 'phaser';
import { DPR, MONO_FONT } from '../config';

export const PARTICLE_GLYPHS = [
  '0',
  '1',
  ';',
  '{',
  '}',
  '(',
  ')',
  '<',
  '>',
  '/',
  '*',
  '+',
  '=',
  '!',
  '#',
  '@',
  '$',
  '~',
  '%',
];

export const PARTICLE_KEYS = PARTICLE_GLYPHS.map((_, i) => `p_${i}`);

export function particleKey(index: number): string {
  return `p_${index}`;
}

export interface GlyphOptions {
  size?: number;
  glow?: number;
  glowAlpha?: number;
  weight?: number;
  color?: string;
}

export function makeGlyphTexture(
  scene: Phaser.Scene,
  key: string,
  text: string,
  options: GlyphOptions = {},
): void {
  if (scene.textures.exists(key)) return;
  const size = Math.round((options.size ?? 26) * DPR);
  const glow = Math.round((options.glow ?? Math.round(size * 0.45)) * DPR);
  const glowAlpha = options.glowAlpha ?? 0.9;
  const weight = options.weight ?? 700;
  const color = options.color ?? '#ffffff';
  const pad = glow + 6;
  const font = `${weight} ${size}px ${MONO_FONT}`;

  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const textWidth = Math.max(1, Math.ceil(ctx.measureText(text).width));
  const textHeight = Math.ceil(size * 1.35);
  canvas.width = textWidth + pad * 2;
  canvas.height = textHeight + pad * 2;

  ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = `rgba(255,255,255,${glowAlpha})`;
  ctx.shadowBlur = glow;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.fillText(text, cx, cy);
  ctx.fillText(text, cx, cy);
  ctx.shadowBlur = glow * 0.45;
  ctx.fillText(text, cx, cy);
  ctx.shadowBlur = 0;
  ctx.fillText(text, cx, cy);

  scene.textures.addCanvas(key, canvas);
}

export function makeGridTexture(scene: Phaser.Scene, key: string, step: number, major: number): void {
  if (scene.textures.exists(key)) return;
  step = Math.round(step * DPR);
  const canvas = document.createElement('canvas');
  canvas.width = step * major;
  canvas.height = step * major;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1a1a28';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#24243a';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(canvas.width, y + 0.5);
    ctx.stroke();
  }

  ctx.strokeStyle = '#2e2e46';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += step * major) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += step * major) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(canvas.width, y + 0.5);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(110,120,170,0.16)';
  ctx.font = `${Math.round(11 * DPR)}px ${MONO_FONT}`;
  ctx.textBaseline = 'top';
  for (let y = step; y < canvas.height; y += step * major) {
    for (let x = step; x < canvas.width; x += step * major) {
      ctx.fillText(String((x / step) * 7 + (y / step) * 3), x + 6 * DPR, y + 5 * DPR);
    }
  }

  scene.textures.addCanvas(key, canvas);
}

export function makePixelTexture(scene: Phaser.Scene, key = 'px'): void {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 2, 2);
  scene.textures.addCanvas(key, canvas);
}

export function makeDotTexture(scene: Phaser.Scene, key: string, radius: number): void {
  if (scene.textures.exists(key)) return;
  const size = radius * 4 * DPR;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  scene.textures.addCanvas(key, canvas);
}

export function makeRingTexture(scene: Phaser.Scene, key: string, radius: number, thickness: number): void {
  if (scene.textures.exists(key)) return;
  radius *= DPR;
  thickness *= DPR;
  const size = radius * 2 + 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = thickness;
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = thickness * 2.5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.stroke();
  scene.textures.addCanvas(key, canvas);
}
