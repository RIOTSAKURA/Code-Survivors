import Phaser from 'phaser';
import { DPR, MONO_FONT, PALETTE, TERRAIN, TEX_SCALE } from '../config';
import { applyTextResolution, setupFixedCamera, viewHeight, viewWidth } from '../core/hidpi';
import { ENEMY_DEFS, SPAWN_POOL, enemyHpScale, enemySpeedScale } from '../data/enemies';
import { ITEM_DEFS, ITEM_IDS, itemDropChance } from '../data/items';
import { ZONE_DEFS, ZONE_KINDS } from '../data/terrain';
import { PASSIVE_DEFS, PASSIVE_IDS } from '../data/passives';
import { WEAPON_DEFS, WEAPON_IDS, cloneCooldown, orbitSpin } from '../data/weapons';

type PageId = 'weapon' | 'enemy' | 'item' | 'zone' | 'passive';

interface Page {
  id: PageId;
  tab: string;
  title: string;
  note: string;
}

interface Entry {
  symbol: string;
  color: number;
  name: string;
  tagline: string;
  desc: string;
  stats: string[];
}

interface CodexHook {
  page: PageId;
  pageIndex: number;
  entries: number;
}

const PAGES: Page[] = [
  { id: 'weapon', tab: '[1] 武器', title: 'weapons/', note: '自动开火 · 每种武器 8 级' },
  { id: 'enemy', tab: '[2] 敌人', title: 'bugs/', note: '基础数值 · 随时间与玩家等级成长' },
  { id: 'item', tab: '[3] 掉落', title: 'drops/', note: '小概率掉落 · 走到拾取圈内即拾取' },
  { id: 'zone', tab: '[4] 地形', title: 'terrain/', note: '随机生成 · 不阻挡移动 · 每 45s 重新编译一次' },
  { id: 'passive', tab: '[5] 被动', title: 'modules/', note: '被动上限 5 级 · 与武器搭配成型' },
];

const ROW_H = 86;
const DESC_CHARS = 46;

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function rateLabel(weaponId: string, cooldown: number): string {
  if (weaponId === 'orbit') return `转速 ${orbitSpin(1).toFixed(1)} → ${orbitSpin(8).toFixed(1)} rad/s`;
  if (weaponId === 'clone') return `分身每 ${cloneCooldown(1).toFixed(2)}s 开火`;
  return `冷却 ${cooldown.toFixed(2)}s`;
}

function wrapDesc(text: string, perLine = DESC_CHARS): string {
  if (text.length <= perLine) return text;
  const lines: string[] = [];
  let rest = text;
  while (rest.length > perLine) {
    let cut = perLine;
    for (let i = perLine; i > perLine - 8 && i > 0; i--) {
      if ('，。、；：·（） '.includes(rest[i])) {
        cut = i + 1;
        break;
      }
    }
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) lines.push(rest);
  return lines.slice(0, 2).join('\n');
}

export class CodexScene extends Phaser.Scene {
  private pageIndex = 0;
  private rowWidth = 820;
  private title!: Phaser.GameObjects.Text;
  private note!: Phaser.GameObjects.Text;
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private rows: Phaser.GameObjects.Container[] = [];

  constructor() {
    super('Codex');
  }

  create(): void {
    this.pageIndex = 0;
    this.rows = [];
    this.tabTexts = [];
    setupFixedCamera(this.cameras.main);
    const cam = this.cameras.main;
    const width = viewWidth(cam);
    this.rowWidth = Math.min(860, width - 96);

    this.add
      .tileSprite(0, 0, width, viewHeight(cam), 'grid')
      .setOrigin(0)
      .setTileScale(TEX_SCALE, TEX_SCALE)
      .setAlpha(0.8);

    const HEADER_GLOW = 14;
    const header = this.add
      .text(48 - (HEADER_GLOW + 8), 30 - (HEADER_GLOW + 4), '▸ codex.md', {
        fontFamily: MONO_FONT,
        fontSize: '26px',
        color: hex(PALETTE.cyan),
        fontStyle: 'bold',
        padding: {
          left: HEADER_GLOW + 8,
          right: HEADER_GLOW + 8,
          top: HEADER_GLOW + 4,
          bottom: HEADER_GLOW + 4,
        },
      })
      .setOrigin(0, 0);
    header.setShadow(0, 0, hex(PALETTE.cyan), HEADER_GLOW, true, true);

    this.tabTexts = PAGES.map((_, i) =>
      this.add.text(48 + i * 118, 72, '', {
        fontFamily: MONO_FONT,
        fontSize: '15px',
        color: hex(PALETTE.textDim),
        fontStyle: 'bold',
      }),
    );

    this.title = this.add
      .text(width - 48, 34, '', {
        fontFamily: MONO_FONT,
        fontSize: '18px',
        color: hex(PALETTE.text),
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);
    this.note = this.add
      .text(width - 48, 58, '', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: hex(PALETTE.textDim),
      })
      .setOrigin(1, 0);
    this.add
      .text(width / 2, viewHeight(cam) - 20, '← → 或 1 2 3 4 5 切换页   ·   C / ESC / 点击 返回菜单', {
        fontFamily: MONO_FONT,
        fontSize: '14px',
        color: hex(PALETTE.textDim),
      })
      .setOrigin(0.5, 1);

    const keyboard = this.input.keyboard!;
    keyboard.on('keydown-C', () => this.close());
    keyboard.on('keydown-ESC', () => this.close());
    keyboard.on('keydown-LEFT', () => this.flip(-1));
    keyboard.on('keydown-RIGHT', () => this.flip(1));
    keyboard.on('keydown-ONE', () => this.show(0));
    keyboard.on('keydown-TWO', () => this.show(1));
    keyboard.on('keydown-THREE', () => this.show(2));
    keyboard.on('keydown-FOUR', () => this.show(3));
    keyboard.on('keydown-FIVE', () => this.show(4));
    this.input.once('pointerdown', () => this.close());

    const hook = window as unknown as { __codex?: CodexHook };
    this.events.once('shutdown', () => {
      hook.__codex = undefined;
    });

    applyTextResolution(this);
    this.show(0);
  }

  private flip(delta: number): void {
    this.show((this.pageIndex + delta + PAGES.length) % PAGES.length);
  }

  private show(index: number): void {
    this.pageIndex = index;
    const page = PAGES[index];
    this.title.setText(page.title);
    this.note.setText(page.note);
    this.tabTexts.forEach((text, i) => {
      text.setText(PAGES[i].tab);
      text.setColor(i === index ? hex(PALETTE.cyan) : hex(PALETTE.textDim));
    });

    const entries = this.buildEntries(page.id);
    const top = 108;
    entries.forEach((entry, i) => {
      const row = this.rows[i] ?? this.buildRow();
      this.rows[i] = row;
      this.fillRow(row, entry);
      row.setPosition(48, top + i * ROW_H);
      row.setVisible(true);
    });
    for (let i = entries.length; i < this.rows.length; i++) this.rows[i].setVisible(false);
  }

  private buildEntries(id: PageId): Entry[] {
    if (id === 'weapon') {
      return WEAPON_IDS.map((weaponId) => {
        const def = WEAPON_DEFS[weaponId];
        return {
          symbol: def.symbol,
          color: def.color,
          name: def.name,
          tagline: def.tagline,
          desc: def.desc,
          stats: [def.detail(1), def.detail(def.maxLevel), rateLabel(weaponId, def.cooldown(1))],
        };
      });
    }
    if (id === 'enemy') {
      const ids = [...SPAWN_POOL, 'boss'] as const;
      return ids.map((enemyId) => {
        const def = ENEMY_DEFS[enemyId];
        const stats = [`HP ${def.hp} · 速度 ${def.speed} · 伤害 ${def.damage} · 经验 ${def.xp}`];
        stats.push(Number.isFinite(def.unlockAt) ? `${def.unlockAt}s 起出现` : '每 115s 登场');
        if (enemyId === 'syntax' || enemyId === 'race') {
          const t = 180;
          stats.push(
            `180s 时：HP ${Math.round(def.hp * enemyHpScale(t, 1))} · 速度 ${Math.round(def.speed * enemySpeedScale(t))}`,
          );
        }
        return {
          symbol: def.glyph,
          color: def.color,
          name: def.name,
          tagline: def.label,
          desc: def.desc,
          stats,
        };
      });
    }
    if (id === 'zone') {
      return ZONE_KINDS.map((kind) => {
        const def = ZONE_DEFS[kind];
        const dur = TERRAIN.charge;
        const stats: string[] = [];
        if (kind === 'include') {
          stats.push(`攻速 +${Math.round(TERRAIN.effects.includeCooldown * 100)}%`);
          stats.push(`${dur.sustain}s 耗尽后消散 · 离场 ${dur.recover}s 回充`);
        } else if (kind === 'pragma') {
          stats.push(`移速 +${Math.round(TERRAIN.effects.pragmaSpeed * 100)}%`);
          stats.push(`${dur.sustain}s 耗尽后消散 · 离场 ${dur.recover}s 回充`);
        } else if (kind === 'leak') {
          stats.push(`敌我移速 ×${TERRAIN.effects.leakSpeed}`);
          stats.push('常驻');
        } else {
          stats.push(`玩家 -${TERRAIN.effects.crashPlayerDps} HP/s`);
          stats.push(`敌人 -${TERRAIN.effects.crashEnemyDps} HP/s`);
          stats.push('击杀无掉落');
        }
        return {
          symbol: def.label,
          color: def.color,
          name: def.name,
          tagline: def.good ? 'buff' : 'risk',
          desc: def.desc,
          stats,
        };
      });
    }
    if (id === 'item') {
      return ITEM_IDS.map((itemId) => {
        const def = ITEM_DEFS[itemId];
        return {
          symbol: def.glyph,
          color: def.color,
          name: def.name,
          tagline: def.tagline,
          desc: def.desc,
          stats: [`${(itemDropChance(itemId) * 100).toFixed(1)}% 每次击杀`, def.detail],
        };
      });
    }
    return PASSIVE_IDS.map((passiveId) => {
      const def = PASSIVE_DEFS[passiveId];
      return {
        symbol: def.symbol,
        color: def.color,
        name: def.name,
        tagline: def.tagline,
        desc: `${def.desc} · ${def.note}`,
        stats: [`最高 ${def.maxLevel} 级`],
      };
    });
  }

  private buildRow(): Phaser.GameObjects.Container {
    const height = ROW_H - 8;
    const bg = this.add.rectangle(0, 0, this.rowWidth, height, 0x181825, 0.92).setOrigin(0);
    bg.setStrokeStyle(1, 0x313244);
    const accent = this.add.rectangle(0, 0, 4, height, PALETTE.cyan).setOrigin(0);
    const symbol = this.add
      .text(52, height / 2, '', {
        fontFamily: MONO_FONT,
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const name = this.add.text(104, 14, '', {
      fontFamily: MONO_FONT,
      fontSize: '17px',
      color: hex(PALETTE.text),
      fontStyle: 'bold',
    });
    const tagline = this.add.text(0, 17, '', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: hex(PALETTE.textDim),
    });
    const desc = this.add.text(104, 40, '', {
      fontFamily: MONO_FONT,
      fontSize: '12px',
      color: hex(PALETTE.text),
      lineSpacing: 3,
    });
    const stats = this.add
      .text(this.rowWidth - 16, 14, '', {
        fontFamily: MONO_FONT,
        fontSize: '12px',
        color: hex(PALETTE.textDim),
        align: 'right',
        lineSpacing: 5,
      })
      .setOrigin(1, 0);

    const texts = [symbol, name, tagline, desc, stats];
    for (const text of texts) text.setResolution(DPR);

    const container = this.add.container(0, 0, [bg, accent, ...texts]);
    container.setData('symbol', symbol);
    container.setData('accent', accent);
    container.setData('name', name);
    container.setData('tagline', tagline);
    container.setData('desc', desc);
    container.setData('stats', stats);
    return container;
  }

  private fillRow(container: Phaser.GameObjects.Container, entry: Entry): void {
    const symbol = container.getData('symbol') as Phaser.GameObjects.Text;
    const accent = container.getData('accent') as Phaser.GameObjects.Rectangle;
    const name = container.getData('name') as Phaser.GameObjects.Text;
    const tagline = container.getData('tagline') as Phaser.GameObjects.Text;
    const desc = container.getData('desc') as Phaser.GameObjects.Text;
    const stats = container.getData('stats') as Phaser.GameObjects.Text;

    symbol.setText(entry.symbol).setColor(hex(entry.color));
    symbol.setFontSize(entry.symbol.length > 4 ? 15 : entry.symbol.length > 2 ? 19 : 26);
    accent.setFillStyle(entry.color);
    name.setText(entry.name);
    tagline.setText(entry.tagline).setX(112 + name.width);
    desc.setText(wrapDesc(entry.desc));
    stats.setText(entry.stats.join('\n'));
  }

  private close(): void {
    this.scene.start('Menu');
  }

  override update(): void {
    const hook = window as unknown as { __codex?: CodexHook };
    hook.__codex = {
      page: PAGES[this.pageIndex].id,
      pageIndex: this.pageIndex,
      entries: this.rows.filter((row) => row.visible).length,
    };
  }
}
