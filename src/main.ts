import Phaser from 'phaser';
import { DPR, PALETTE } from './config';
import { sfx } from './core/audio';
import type { SfxName } from './core/audio';
import { bus, hud } from './core/state';
import { BootScene } from './scenes/BootScene';
import { CodexScene } from './scenes/CodexScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { UIScene } from './scenes/UIScene';

bus.on<SfxName>('sfx', (name) => sfx.play(name));

(window as unknown as { __hud: typeof hud }).__hud = hud;

const versionLabel = document.getElementById('version');
if (versionLabel) versionLabel.textContent = `v${__APP_VERSION__}`;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: Math.floor(window.innerWidth * DPR),
  height: Math.floor(window.innerHeight * DPR),
  backgroundColor: PALETTE.bg,
  banner: false,
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: Math.floor(window.innerWidth * DPR),
    height: Math.floor(window.innerHeight * DPR),
  },
  input: {
    keyboard: true,
    mouse: true,
    touch: true,
  },
  render: {
    antialias: true,
    antialiasGL: DPR === 1,
    powerPreference: 'high-performance',
    roundPixels: false,
  },
  fps: {
    target: 60,
    forceSetTimeOut: false,
  },
  scene: [BootScene, MenuScene, CodexScene, GameScene, UIScene],
});

const canvas = game.canvas;

const applyViewport = (): void => {
  const width = Math.floor(window.innerWidth * DPR);
  const height = Math.floor(window.innerHeight * DPR);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  if (game.scale.width !== width || game.scale.height !== height) {
    game.scale.resize(width, height);
  }
};

game.scale.setZoom(1 / DPR);
applyViewport();
window.addEventListener('resize', applyViewport);
window.addEventListener('orientationchange', applyViewport);

const unlock = () => sfx.unlock();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);
