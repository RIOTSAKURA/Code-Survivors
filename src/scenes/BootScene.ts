import Phaser from 'phaser';
import {
  PARTICLE_GLYPHS,
  makeDotTexture,
  makeGlyphTexture,
  makeGridTexture,
  makePixelTexture,
  makeZoneGlowTexture,
  makeZoneRingTexture,
  particleKey,
} from '../core/textures';

const ENEMY_TEXTURES: Array<[string, string, number]> = [
  ['e_syntax', '~', 32],
  ['e_nullptr', 'null', 22],
  ['e_memleak', '[]', 28],
  ['e_race', '<<', 26],
  ['e_stack', '{}', 38],
  ['e_thrower', 'throw', 24],
  ['e_deadlock', '=X=', 26],
  ['e_breakpoint', '^!', 26],
  ['e_daemon', '&', 30],
  ['e_boss', '0xDEAD', 58],
  ['e_boss2', '0xT0C', 54],
];

const ITEM_TEXTURES: Array<[string, string, number]> = [
  ['item_hotfix', 'hotfix', 22],
  ['item_sigkill', 'kill -9', 22],
  ['item_fetch', 'fetch', 22],
];

const WEAPON_TEXTURES: Array<[string, string, number]> = [
  ['w_dart', ';', 24],
  ['w_orbit', '()', 20],
  ['w_bomb', '!', 26],
  ['w_clone', 'fn()', 20],
];

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    makePixelTexture(this);
    makeGridTexture(this, 'grid', 40, 5);
    makeDotTexture(this, 'dot', 8);
    makeZoneGlowTexture(this, 'zoneGlow');
    makeZoneRingTexture(this, 'zoneRing');
    makeGlyphTexture(this, 'player', '</>', { size: 30, glow: 14 });
    makeGlyphTexture(this, 'orb_0', '0', { size: 18, glow: 8 });
    makeGlyphTexture(this, 'orb_1', '1', { size: 18, glow: 8 });
    makeGlyphTexture(this, 'proj_bullet', '*', { size: 20, glow: 8 });
    for (const [key, glyph, size] of ENEMY_TEXTURES) {
      makeGlyphTexture(this, key, glyph, { size, glow: Math.round(size * 0.34) });
    }
    for (const [key, glyph, size] of ITEM_TEXTURES) {
      makeGlyphTexture(this, key, glyph, { size, glow: Math.round(size * 0.5) });
    }
    for (const [key, glyph, size] of WEAPON_TEXTURES) {
      makeGlyphTexture(this, key, glyph, { size, glow: Math.round(size * 0.45) });
    }
    PARTICLE_GLYPHS.forEach((glyph, index) => {
      makeGlyphTexture(this, particleKey(index), glyph, { size: 18, glow: 6 });
    });

    document.getElementById('boot-hint')?.remove();
    this.scene.start('Menu');
  }
}
