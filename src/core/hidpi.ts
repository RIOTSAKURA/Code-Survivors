import Phaser from 'phaser';
import { DPR } from '../config';

export { DPR };

export function applyTextResolution(scene: Phaser.Scene, resolution: number = DPR): void {
  if (resolution === 1) return;
  const walk = (list: Phaser.GameObjects.GameObject[]): void => {
    for (const child of list) {
      if (child instanceof Phaser.GameObjects.Text) child.setResolution(resolution);
      else if (child instanceof Phaser.GameObjects.Container) walk(child.list);
    }
  };
  walk(scene.children.list);
}

export function viewWidth(camera: Phaser.Cameras.Scene2D.Camera): number {
  return camera.width / camera.zoomX;
}

export function viewHeight(camera: Phaser.Cameras.Scene2D.Camera): number {
  return camera.height / camera.zoomY;
}

export function setupFixedCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
  camera.setOrigin(0, 0);
  camera.setZoom(DPR);
}

export function setupWorldCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
  camera.setZoom(DPR);
}
