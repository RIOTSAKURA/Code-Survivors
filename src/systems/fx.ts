import Phaser from 'phaser';
import { DEPTH, MONO_FONT, TEX_SCALE } from '../config';
import { ImagePool, TextPool } from '../core/pool';
import { rng } from '../core/rng';
import { PARTICLE_GLYPHS, particleKey } from '../core/textures';
import type { Particle } from '../core/types';

interface Floater {
  obj: Phaser.GameObjects.Text;
  life: number;
  maxLife: number;
  vy: number;
  vx: number;
}

const MAX_PARTICLES = 900;

export class Fx {
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private images: ImagePool;
  private texts: TextPool;

  constructor(scene: Phaser.Scene) {
    this.images = new ImagePool(scene, 1100, DEPTH.particle, Phaser.BlendModes.ADD);
    this.texts = new TextPool(
      scene,
      70,
      { fontFamily: MONO_FONT, fontSize: '14px', color: '#ffffff', fontStyle: 'bold' },
      DEPTH.floater,
    );
  }

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    color: number,
    life: number,
    size: number,
    drag = 0.9,
  ): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const glyphIndex = rng.int(0, PARTICLE_GLYPHS.length - 1);
    const sprite = this.images.acquire();
    sprite.setTexture(particleKey(glyphIndex));
    sprite.setPosition(x, y);
    sprite.setTint(color);
    sprite.setScale(size * TEX_SCALE);
    sprite.setAlpha(1);
    sprite.setAngle(rng.range(-25, 25));
    this.particles.push({
      x,
      y,
      vx,
      vy,
      life,
      maxLife: life,
      drag,
      size,
      color,
      spin: rng.range(-180, 180),
      sprite,
      dead: false,
    });
  }

  burst(x: number, y: number, color: number, count: number, speed = 150, life = 0.5, size = 0.7): void {
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const sp = rng.range(speed * 0.35, speed);
      this.spawnParticle(
        x,
        y,
        Math.cos(angle) * sp,
        Math.sin(angle) * sp,
        color,
        rng.range(life * 0.6, life * 1.3),
        size * rng.range(0.7, 1.25),
      );
    }
  }

  trail(x: number, y: number, color: number, size = 0.5): void {
    this.spawnParticle(x, y, rng.range(-14, 14), rng.range(-14, 14), color, 0.24, size, 0.86);
  }

  sparks(x: number, y: number, color: number, count = 4): void {
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const sp = rng.range(60, 210);
      this.spawnParticle(x, y, Math.cos(angle) * sp, Math.sin(angle) * sp, color, 0.3, 0.55, 0.8);
    }
  }

  text(x: number, y: number, value: string, color: string, size = 14): void {
    if (this.floaters.length > 60) return;
    const obj = this.texts.acquire(value, color, size);
    obj.setPosition(x, y);
    this.floaters.push({
      obj,
      life: 0.7,
      maxLife: 0.7,
      vy: -55,
      vx: rng.range(-22, 22),
    });
  }

  damageText(x: number, y: number, amount: number, crit: boolean): void {
    const color = crit ? '#ffe066' : '#ffffff';
    this.text(x, y, crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`, color, crit ? 18 : 13);
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0 || !p.sprite) {
        if (p.sprite) this.images.release(p.sprite);
        p.dead = true;
        const last = this.particles.pop()!;
        if (i < this.particles.length) this.particles[i] = last;
        continue;
      }
      const drag = Math.pow(p.drag, dt * 60);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.maxLife;
      p.sprite.setPosition(p.x, p.y);
      p.sprite.setAlpha(Math.min(1, t * 1.6));
      p.sprite.setScale(p.size * (0.45 + 0.55 * t) * TEX_SCALE);
      p.sprite.setAngle(p.sprite.angle + p.spin * dt);
    }

    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.texts.release(f.obj);
        const last = this.floaters.pop()!;
        if (i < this.floaters.length) this.floaters[i] = last;
        continue;
      }
      f.vy *= 0.94;
      f.obj.x += f.vx * dt;
      f.obj.y += f.vy * dt;
      f.obj.setAlpha(Math.min(1, f.life / f.maxLife + 0.15));
      f.obj.setScale(0.85 + 0.35 * (1 - f.life / f.maxLife));
    }
  }

  clear(): void {
    for (const p of this.particles) {
      if (p.sprite) this.images.release(p.sprite);
    }
    this.particles.length = 0;
    for (const f of this.floaters) this.texts.release(f.obj);
    this.floaters.length = 0;
  }

  get particleCount(): number {
    return this.particles.length;
  }
}
