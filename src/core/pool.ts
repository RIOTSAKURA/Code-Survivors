import Phaser from 'phaser';
import { DPR, TEX_SCALE } from '../config';

export class ImagePool {
  private readonly free: Phaser.GameObjects.Image[] = [];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, size: number, depth: number, blend: Phaser.BlendModes) {
    this.scene = scene;
    for (let i = 0; i < size; i++) {
      const img = scene.add.image(-100, -100, 'px');
      img.setDepth(depth);
      img.setBlendMode(blend);
      img.setVisible(false);
      this.free.push(img);
    }
  }

  acquire(): Phaser.GameObjects.Image {
    let img = this.free.pop();
    if (!img) {
      img = this.scene.add.image(-100, -100, 'px');
      img.setBlendMode(Phaser.BlendModes.ADD);
    }
    img.setActive(true);
    img.setVisible(true);
    img.setAlpha(1);
    img.setScale(TEX_SCALE);
    img.setAngle(0);
    img.setTint(0xffffff);
    return img;
  }

  release(img: Phaser.GameObjects.Image): void {
    img.setVisible(false);
    img.setActive(false);
    this.free.push(img);
  }
}

export class TextPool {
  private readonly free: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    size: number,
    private readonly style: Phaser.Types.GameObjects.Text.TextStyle,
    depth: number,
  ) {
    for (let i = 0; i < size; i++) {
      const t = scene.add.text(0, 0, '', style);
      t.setOrigin(0.5);
      t.setResolution(DPR);
      t.setDepth(depth);
      t.setVisible(false);
      this.free.push(t);
    }
  }

  acquire(text: string, color: string, size: number): Phaser.GameObjects.Text {
    let t = this.free.pop();
    if (!t) {
      t = this.scene.add.text(0, 0, '', this.style);
      t.setOrigin(0.5);
      t.setResolution(DPR);
    }
    t.setText(text);
    t.setColor(color);
    t.setFontSize(size);
    t.setVisible(true);
    t.setAlpha(1);
    t.setScale(1);
    return t;
  }

  release(t: Phaser.GameObjects.Text): void {
    t.setVisible(false);
    this.free.push(t);
  }
}
