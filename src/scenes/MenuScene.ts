import Phaser from 'phaser';
import { MONO_FONT, TEX_SCALE } from '../config';
import { ImagePool } from '../core/pool';
import { Rng } from '../core/rng';
import { ENEMY_DEFS, SPAWN_POOL } from '../data/enemies';
import { Fx } from '../systems/fx';
import { sfx } from '../core/audio';
import { applyTextResolution, setupFixedCamera, viewHeight, viewWidth } from '../core/hidpi';
import { readBest, formatTime } from '../core/records';

interface Marcher {
  x: number;
  y: number;
  speed: number;
  stopX: number;
  sprite: Phaser.GameObjects.Image;
}

interface MarcherKind {
  key: string;
  color: number;
  scale: number;
  rush: number;
}

const MOB_DEPTH = 1;
const BOSS_ODDS = 0.07;

export class MenuScene extends Phaser.Scene {
  private container!: Phaser.GameObjects.Container;
  private rng = new Rng();
  private marchers: Marcher[] = [];
  private marcherSprites!: ImagePool;
  private fx!: Fx;
  private kinds: MarcherKind[] = [];

  constructor() {
    super('Menu');
  }

  create(): void {
    this.rng = new Rng();
    this.marchers = [];
    setupFixedCamera(this.cameras.main);
    const view = { w: viewWidth(this.cameras.main), h: viewHeight(this.cameras.main) };

    this.add
      .tileSprite(0, 0, view.w, view.h, 'grid')
      .setOrigin(0)
      .setTileScale(TEX_SCALE, TEX_SCALE)
      .setAlpha(0.85);

    this.fx = new Fx(this, { images: 320, texts: 8 });
    this.marcherSprites = new ImagePool(this, 48, MOB_DEPTH, Phaser.BlendModes.ADD);
    this.buildMarcherKinds();
    for (let i = 0; i < 7; i++) this.spawnMarcher(true);
    this.time.addEvent({
      delay: 320,
      loop: true,
      callback: () => this.spawnSquad(),
    });

    this.container = this.add.container(0, 0).setDepth(10);

    const TITLE_GLOW = 22;
    const title = this.add
      .text(0, -190, 'CODE SURVIVORS', {
        fontFamily: MONO_FONT,
        fontSize: '58px',
        color: '#00ffff',
        fontStyle: 'bold',
        padding: {
          left: TITLE_GLOW + 12,
          right: TITLE_GLOW + 12,
          top: TITLE_GLOW + 6,
          bottom: TITLE_GLOW + 6,
        },
      })
      .setOrigin(0.5);
    title.setShadow(0, 0, '#00ffff', TITLE_GLOW, true, true);

    const sub = this.add
      .text(0, -134, '// survive the bug flood · collect binary · ship or die', {
        fontFamily: MONO_FONT,
        fontSize: '16px',
        color: '#6c7086',
      })
      .setOrigin(0.5);

    const controls = this.add
      .text(
        0,
        -70,
        [
          'WASD / ARROWS   move',
          'AUTO            fire at nearest bug',
          '1 2 3 / CLICK   pick upgrade',
          'P / ESC         pause        M  mute',
        ].join('\n'),
        {
          fontFamily: MONO_FONT,
          fontSize: '15px',
          color: '#cdd6f4',
          lineSpacing: 6,
        },
      )
      .setOrigin(0.5);

    const best = readBest();
    const record = best
      ? `BEST RUN   ${formatTime(best.time)}   ${best.kills} kills   LVL ${best.level}`
      : 'BEST RUN   --:--   no data';

    const recordText = this.add
      .text(0, 60, record, {
        fontFamily: MONO_FONT,
        fontSize: '15px',
        color: '#00ff41',
      })
      .setOrigin(0.5);

    const codex = this.add
      .text(0, 108, '[ C ]  查阅图鉴 codex（武器 / 敌人 / 掉落 / 地形 / 事件 / 被动）', {
        fontFamily: MONO_FONT,
        fontSize: '15px',
        color: '#7f849c',
      })
      .setOrigin(0.5);

    const prompt = this.add
      .text(0, 152, '[ ENTER / CLICK ]  npm start', {
        fontFamily: MONO_FONT,
        fontSize: '22px',
        color: '#ffe066',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const modules = this.add
      .text(0, 220, 'modules:  ;   ()   !   /regex/   //   fn()    ++  >>  []  {}  =>  T  ||  ~', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: '#7f849c',
      })
      .setOrigin(0.5);

    this.container.add([title, sub, controls, recordText, codex, prompt, modules]);

    this.tweens.add({
      targets: prompt,
      alpha: { from: 1, to: 0.25 },
      duration: 700,
      yoyo: true,
      repeat: -1,
    });
    this.tweens.add({
      targets: title,
      scaleX: { from: 1, to: 1.015 },
      scaleY: { from: 1, to: 1.015 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    const start = () => {
      sfx.unlock();
      this.scene.start('Game');
      this.scene.launch('UI');
    };
    const startWidth = viewWidth(this.cameras.main);
    const startHeight = viewHeight(this.cameras.main);
    this.add
      .zone(0, 0, startWidth, startHeight)
      .setOrigin(0)
      .setDepth(-1)
      .setInteractive(
        new Phaser.Geom.Rectangle(0, 0, startWidth, startHeight),
        Phaser.Geom.Rectangle.Contains,
      )
      .once('pointerdown', start);
    const openCodex = () => {
      sfx.unlock();
      sfx.play('choose');
      this.scene.start('Codex');
    };
    this.input.keyboard!.once('keydown-ENTER', start);
    this.input.keyboard!.once('keydown-SPACE', start);
    this.input.keyboard!.once('keydown-C', openCodex);
    codex.setInteractive({ useHandCursor: true }).on('pointerdown', openCodex);

    applyTextResolution(this);
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.layout, this);
      (window as unknown as { __menu?: unknown }).__menu = undefined;
    });
  }

  private layout(): void {
    this.container.setPosition(viewWidth(this.cameras.main) / 2, viewHeight(this.cameras.main) / 2);
  }

  private buildMarcherKinds(): void {
    this.kinds = SPAWN_POOL.map((id) => {
      const def = ENEMY_DEFS[id];
      return { key: `e_${id}`, color: def.color, scale: 1, rush: 90 + def.speed * 0.9 };
    });
    const boss = ENEMY_DEFS.boss;
    this.kinds.push({ key: 'e_boss', color: boss.color, scale: 0.5, rush: 70 });
  }

  private spawnSquad(): void {
    const wave = this.rng.chance(0.22) ? 3 : 1;
    for (let i = 0; i < wave; i++) this.spawnMarcher(false);
  }

  private spawnMarcher(spreadIn: boolean): void {
    const view = { w: viewWidth(this.cameras.main), h: viewHeight(this.cameras.main) };
    const centre = view.w / 2;
    const boss = this.rng.chance(BOSS_ODDS);
    const kind = boss ? this.kinds[this.kinds.length - 1] : this.rng.pick(this.kinds.slice(0, -1));
    const fromLeft = this.rng.chance(0.5);
    const y = this.rng.range(view.h * 0.08, view.h * 0.92);
    const start = fromLeft ? -60 : view.w + 60;
    const x = spreadIn ? this.rng.range(start, fromLeft ? centre * 0.35 : view.w - centre * 0.35) : start;
    const gap = this.rng.range(0.27, 0.42) * view.w;

    const sprite = this.marcherSprites.acquire();
    sprite.setTexture(kind.key);
    sprite.setTint(kind.color);
    sprite.setScale(kind.scale * TEX_SCALE * this.rng.range(0.9, 1.15));
    sprite.setPosition(x, y);
    sprite.setAlpha(this.rng.range(0.55, 0.9));

    this.marchers.push({
      x,
      y,
      speed: kind.rush * this.rng.range(0.85, 1.3),
      stopX: fromLeft ? centre - gap / 2 : centre + gap / 2,
      sprite,
    });
  }

  private updateMarchers(dt: number): void {
    for (let i = this.marchers.length - 1; i >= 0; i--) {
      const m = this.marchers[i];
      const dir = Math.sign(m.stopX - m.x);
      const remaining = Math.abs(m.stopX - m.x);
      const boost = remaining < 320 ? 1.6 : 1;
      m.x += dir * m.speed * boost * dt;
      m.sprite.setPosition(m.x, m.y);
      m.sprite.setRotation(dir * 0.12);
      if (remaining < 26) {
        this.fx.burst(m.x, m.y, m.sprite.tintTopLeft, 7, 230, 0.55, 0.7);
        this.marcherSprites.release(m.sprite);
        const last = this.marchers.pop()!;
        if (i < this.marchers.length) this.marchers[i] = last;
      }
    }
    this.fx.update(dt);
  }

  override update(_time: number, delta: number): void {
    this.updateMarchers(Math.min(delta / 1000, 1 / 30));
    const hook = window as unknown as { __menu?: { marchers: number; particles: number } };
    hook.__menu = { marchers: this.marchers.length, particles: this.fx.particleCount };
  }
}
