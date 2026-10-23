import Phaser from 'phaser';
import { MONO_FONT, TEX_SCALE } from '../config';
import { sfx } from '../core/audio';
import { applyTextResolution, setupFixedCamera, viewHeight, viewWidth } from '../core/hidpi';
import { readBest, formatTime } from '../core/records';

export class MenuScene extends Phaser.Scene {
  private container!: Phaser.GameObjects.Container;

  constructor() {
    super('Menu');
  }

  create(): void {
    setupFixedCamera(this.cameras.main);
    this.add
      .tileSprite(0, 0, viewWidth(this.cameras.main), viewHeight(this.cameras.main), 'grid')
      .setOrigin(0)
      .setTileScale(TEX_SCALE, TEX_SCALE)
      .setAlpha(0.85);

    this.container = this.add.container(0, 0);

    const title = this.add
      .text(0, -190, 'CODE SURVIVORS', {
        fontFamily: MONO_FONT,
        fontSize: '58px',
        color: '#00ffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    title.setShadow(0, 0, '#00ffff', 22, true, true);

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

    const prompt = this.add
      .text(0, 140, '[ ENTER / CLICK ]  npm start', {
        fontFamily: MONO_FONT,
        fontSize: '22px',
        color: '#ffe066',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const modules = this.add
      .text(0, 214, 'modules:  ;   ()   !   /regex/   //   fn()    ++  >>  []  {}  =>  T  ||  ~', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: '#7f849c',
      })
      .setOrigin(0.5);

    this.container.add([title, sub, controls, recordText, prompt, modules]);

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
    this.input.keyboard!.once('keydown-ENTER', start);
    this.input.keyboard!.once('keydown-SPACE', start);
    this.input.once('pointerdown', start);

    applyTextResolution(this);
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  private layout(): void {
    this.container.setPosition(viewWidth(this.cameras.main) / 2, viewHeight(this.cameras.main) / 2);
  }
}
