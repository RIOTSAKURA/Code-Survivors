import Phaser from 'phaser';
import { DPR, MONO_FONT, PALETTE, SPAWN, TERRAIN, TEX_SCALE } from '../config';
import { applyTextResolution, setupFixedCamera, viewHeight, viewWidth } from '../core/hidpi';
import { ENEMY_DEFS, SPAWN_POOL, enemyHpScale, enemySpeedScale } from '../data/enemies';
import { ITEM_DEFS, ITEM_IDS, itemDropChance } from '../data/items';
import { TERRAIN_EVENTS, ZONE_DEFS, ZONE_KINDS } from '../data/terrain';
import {
  CACHE_PASSIVE,
  GC_PASSIVE,
  PARALLEL_PASSIVE,
  PASSIVE_DEFS,
  PASSIVE_IDS,
  TYPESAFE_PASSIVE,
} from '../data/passives';
import { EVOLUTION_DEFS, EVOLUTION_LEVEL, evolutionsFor } from '../data/evolutions';
import { WEAPON_DEFS, WEAPON_IDS, cloneCooldown, orbitSpin } from '../data/weapons';

type PageId = 'weapon' | 'enemy' | 'item' | 'zone' | 'event' | 'passive';

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
  scroll: number;
  maxScroll: number;
}

const PAGES: Page[] = [
  { id: 'weapon', tab: '[1] 武器', title: 'weapons/', note: '自动开火 · 每种武器 8 级' },
  { id: 'enemy', tab: '[2] 敌人', title: 'bugs/', note: '基础数值 · 随时间与玩家等级成长' },
  { id: 'item', tab: '[3] 掉落', title: 'drops/', note: '小概率掉落 · 走到拾取圈内即拾取' },
  { id: 'zone', tab: '[4] 地形', title: 'terrain/', note: '随机生成 · 不阻挡移动 · 每 45s 重新编译一次' },
  { id: 'event', tab: '[5] 事件', title: 'events/', note: '按 E 接受 · 限时完成换取进化或稀有模块' },
  { id: 'passive', tab: '[6] 被动', title: 'modules/', note: '被动上限 5 级 · 与武器搭配成型' },
];

const WIDE_ROW = 84;
const COMPACT_ROW = 124;
const ROW_GAP = 8;
const WIDE_BREAKPOINT = 720;
const DESC_CHARS = 46;

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function rateLabel(weaponId: string, cooldown: number): string {
  if (weaponId === 'orbit') return `转速 ${orbitSpin(1).toFixed(1)} → ${orbitSpin(8).toFixed(1)} rad/s`;
  if (weaponId === 'clone') return `分身每 ${cloneCooldown(1).toFixed(2)}s 开火`;
  return `冷却 ${cooldown.toFixed(2)}s`;
}

function wrapDesc(text: string, perLine = DESC_CHARS, maxLines = 2): string {
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
  return lines.slice(0, maxLines).join('\n');
}

export class CodexScene extends Phaser.Scene {
  private pageIndex = 0;
  private rowWidth = 820;
  private rowX = 48;
  private rowHeight = WIDE_ROW;
  private rowStep = WIDE_ROW + ROW_GAP;
  private compact = false;
  private listTop = 108;
  private listBottom = 0;
  private scroll = 0;
  private maxScroll = 0;
  private entryCount = 0;
  private backdrop!: Phaser.GameObjects.TileSprite;
  private header!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private note!: Phaser.GameObjects.Text;
  private footer!: Phaser.GameObjects.Text;
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private rows: Phaser.GameObjects.Container[] = [];
  private list!: Phaser.GameObjects.Container;
  private listMaskShape!: Phaser.GameObjects.Graphics;
  private scrollTrack!: Phaser.GameObjects.Rectangle;
  private scrollThumb!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('Codex');
  }

  create(): void {
    this.pageIndex = 0;
    this.rows = [];
    this.tabTexts = [];
    this.scroll = 0;
    this.entryCount = 0;
    setupFixedCamera(this.cameras.main);
    const cam = this.cameras.main;

    this.backdrop = this.add
      .tileSprite(0, 0, viewWidth(cam), viewHeight(cam), 'grid')
      .setOrigin(0)
      .setTileScale(TEX_SCALE, TEX_SCALE)
      .setAlpha(0.8);

    const HEADER_GLOW = 14;
    this.header = this.add
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
    this.header.setShadow(0, 0, hex(PALETTE.cyan), HEADER_GLOW, true, true);

    this.tabTexts = PAGES.map(() =>
      this.add.text(48, 72, '', {
        fontFamily: MONO_FONT,
        fontSize: '15px',
        color: hex(PALETTE.textDim),
        fontStyle: 'bold',
      }),
    );

    this.title = this.add
      .text(0, 34, '', {
        fontFamily: MONO_FONT,
        fontSize: '18px',
        color: hex(PALETTE.text),
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);
    this.note = this.add
      .text(0, 58, '', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: hex(PALETTE.textDim),
      })
      .setOrigin(1, 0);
    this.footer = this.add
      .text(0, 0, '', {
        fontFamily: MONO_FONT,
        fontSize: '14px',
        color: hex(PALETTE.textDim),
      })
      .setOrigin(0.5, 1);

    this.list = this.add.container(0, 0);
    this.listMaskShape = this.make.graphics();
    this.list.setMask(this.listMaskShape.createGeometryMask());

    this.scrollTrack = this.add
      .rectangle(0, 0, 3, 10, 0x313244, 0.7)
      .setOrigin(0, 0)
      .setVisible(false);
    this.scrollThumb = this.add
      .rectangle(0, 0, 5, 10, PALETTE.cyan, 0.7)
      .setOrigin(0, 0)
      .setVisible(false);

    const keyboard = this.input.keyboard!;
    keyboard.on('keydown-C', () => this.close());
    keyboard.on('keydown-ESC', () => this.close());
    keyboard.on('keydown-LEFT', () => this.flip(-1));
    keyboard.on('keydown-RIGHT', () => this.flip(1));
    keyboard.on('keydown-UP', () => this.scrollBy(-this.rowStep));
    keyboard.on('keydown-DOWN', () => this.scrollBy(this.rowStep));
    keyboard.on('keydown-W', () => this.scrollBy(-this.rowStep));
    keyboard.on('keydown-S', () => this.scrollBy(this.rowStep));
    keyboard.on('keydown-ONE', () => this.show(0));
    keyboard.on('keydown-TWO', () => this.show(1));
    keyboard.on('keydown-THREE', () => this.show(2));
    keyboard.on('keydown-FOUR', () => this.show(3));
    keyboard.on('keydown-FIVE', () => this.show(4));
    keyboard.on('keydown-SIX', () => this.show(5));
    this.input.on(
      'wheel',
      (_pointer: Phaser.Input.Pointer, _over: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
        if (dy !== 0) this.scrollBy(Math.sign(dy) * this.rowStep);
      },
    );
    this.input.once('pointerdown', () => this.close());

    const hook = window as unknown as { __codex?: CodexHook };
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => {
      hook.__codex = undefined;
      this.scale.off('resize', this.layout, this);
    });

    applyTextResolution(this);
    this.layout();
    this.show(0);
  }

  private layout(): void {
    const cam = this.cameras.main;
    const width = viewWidth(cam);
    const height = viewHeight(cam);
    this.backdrop.setSize(width, height);
    this.rowWidth = Math.min(900, width - 96);
    this.rowX = 48;
    this.compact = this.rowWidth < WIDE_BREAKPOINT;
    this.rowHeight = this.compact ? (this.rowWidth < 520 ? COMPACT_ROW + 20 : COMPACT_ROW) : WIDE_ROW;
    this.rowStep = this.rowHeight + ROW_GAP;
    this.listTop = 108;
    this.listBottom = Math.max(this.listTop + 120, height - 48);
    const view = this.listBottom - this.listTop;
    const narrow = width < 760;

    const gap = Math.min(118, (width - 96) / PAGES.length);
    this.tabTexts.forEach((text, i) => {
      text.setPosition(48 + i * gap, 72).setFontSize(narrow ? 13 : 15);
    });
    this.title.setPosition(width - 48, 34).setFontSize(narrow ? 16 : 18);
    this.note.setPosition(width - 48, 58).setFontSize(narrow ? 12 : 13);
    this.footer.setPosition(width / 2, height - 20).setFontSize(narrow ? 12 : 14);
    this.footer.setText(
      narrow
        ? '←→ 切页 · ↑↓ / 滚轮 滚动 · C 返回'
        : '← → / 1 2 3 4 5 6 切换页   ·   ↑ ↓ / 滚轮 滚动   ·   C / ESC / 点击 返回菜单',
    );

    this.listMaskShape.clear();
    this.listMaskShape.fillStyle(0xffffff, 1);
    this.listMaskShape.fillRect(this.rowX - 8, this.listTop, this.rowWidth + 16, view);

    if (this.rows.length > 0) {
      this.rebuildRows();
      return;
    }
    this.layoutRows();
    this.updateScrollbar();
  }

  private rebuildRows(): void {
    for (const row of this.rows) row.destroy();
    this.rows = [];
    this.show(this.pageIndex, false);
  }

  private flip(delta: number): void {
    this.show((this.pageIndex + delta + PAGES.length) % PAGES.length);
  }

  private show(index: number, resetScroll = true): void {
    this.pageIndex = index;
    const page = PAGES[index];
    this.title.setText(page.title);
    this.note.setText(page.note);
    this.tabTexts.forEach((text, i) => {
      text.setText(PAGES[i].tab);
      text.setColor(i === index ? hex(PALETTE.cyan) : hex(PALETTE.textDim));
    });

    const entries = this.buildEntries(page.id);
    this.entryCount = entries.length;
    if (resetScroll) this.scroll = 0;
    entries.forEach((entry, i) => {
      const row = this.rows[i] ?? this.buildRow();
      this.rows[i] = row;
      this.fillRow(row, entry);
      row.setVisible(true);
    });
    for (let i = entries.length; i < this.rows.length; i++) this.rows[i].setVisible(false);
    this.layoutRows();
    this.updateScrollbar();
  }

  private layoutRows(): void {
    const view = this.listBottom - this.listTop;
    const content = Math.max(0, this.entryCount * this.rowStep - ROW_GAP);
    this.maxScroll = Math.max(0, content - view);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, this.maxScroll);
    for (let i = 0; i < this.rows.length; i++) {
      this.rows[i].setPosition(this.rowX, this.listTop + i * this.rowStep - this.scroll);
    }
  }

  private scrollBy(delta: number): void {
    if (this.maxScroll <= 0) return;
    this.scroll = Phaser.Math.Clamp(this.scroll + delta, 0, this.maxScroll);
    this.layoutRows();
    this.updateScrollbar();
  }

  private updateScrollbar(): void {
    const view = this.listBottom - this.listTop;
    const content = Math.max(0, this.entryCount * this.rowStep - ROW_GAP);
    const overflow = content > view;
    this.scrollTrack.setVisible(overflow);
    this.scrollThumb.setVisible(overflow);
    if (!overflow) return;
    const thumbHeight = Math.max(24, (view * view) / content);
    const range = Math.max(1, view - thumbHeight);
    this.scrollTrack
      .setPosition(this.rowX + this.rowWidth + 10, this.listTop)
      .setSize(3, view);
    this.scrollThumb
      .setPosition(
        this.rowX + this.rowWidth + 9,
        this.listTop + (this.scroll / Math.max(1, this.maxScroll)) * range,
      )
      .setSize(5, thumbHeight);
  }

  private buildEntries(id: PageId): Entry[] {
    if (id === 'weapon') {
      return WEAPON_IDS.map((weaponId) => {
        const def = WEAPON_DEFS[weaponId];
        const stats = [def.detail(1), def.detail(def.maxLevel), rateLabel(weaponId, def.cooldown(1))];
        const branches = evolutionsFor(weaponId);
        if (branches.length > 0) {
          const names = branches.map(
            (id) => `${EVOLUTION_DEFS[id].branch}${EVOLUTION_DEFS[id].name.slice(0, 2)}`,
          );
          stats.push(`Lv${EVOLUTION_LEVEL} 进化：${names.join('/')}`);
        }
        return {
          symbol: def.symbol,
          color: def.color,
          name: def.name,
          tagline: def.tagline,
          desc: def.desc,
          stats,
        };
      });
    }
    if (id === 'enemy') {
      const ids = [...SPAWN_POOL, 'boss', 'boss2'] as const;
      return ids.map((enemyId) => {
        const def = ENEMY_DEFS[enemyId];
        const stats = [`HP ${def.hp} · 速度 ${def.speed} · 伤害 ${def.damage} · 经验 ${def.xp}`];
        stats.push(
          Number.isFinite(def.unlockAt)
            ? `${def.unlockAt}s 起出现`
            : enemyId === 'boss2'
              ? `第二个 Boss · 每 ${SPAWN.bossEvery}s 交替登场`
              : `每 ${SPAWN.bossEvery}s 登场`,
        );
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
      const entries: Entry[] = ZONE_KINDS.map((kind) => {
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
      return entries;
    }
    if (id === 'event') {
      return (['compile', 'packet', 'commit'] as const).map((kind) => {
        const def = TERRAIN_EVENTS[kind];
        const stats: string[] = [];
        if (kind === 'compile') {
          stats.push(`按 E 启动 · ${TERRAIN.event.chargeTime}s 完成`);
          stats.push(
            `编译期间攻速 -${Math.round((1 - TERRAIN.event.compileAttackSpeed) * 100)}% · 受伤 +${Math.round((TERRAIN.event.compileDamageTaken - 1) * 100)}%`,
          );
          stats.push('奖励：免费模块选择');
          stats.push(`首个目标 ${TERRAIN.eventSystem.firstDelay}s 后出现`);
        } else if (kind === 'packet') {
          stats.push(`按 E 接受 · ${TERRAIN.packet.collectTime}s 内收齐碎片`);
          stats.push(`拾取 ${TERRAIN.packet.fragments} 块散落碎片`);
          stats.push(`靠近碎片刷出 ${TERRAIN.packet.guards} 名守卫 · 清掉后才能拾取`);
          stats.push('奖励：武器进化');
        } else {
          stats.push(`按 E 接受 · ${TERRAIN.commit.duration}s 内`);
          stats.push(`击杀 ${TERRAIN.commit.need} 个强化敌人`);
          stats.push('奖励：稀有模块');
        }
        return {
          symbol: def.label,
          color: def.color,
          name: def.name,
          tagline: 'event',
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
      const stats = [`最高 ${def.maxLevel} 级`];
      if (passiveId === 'cache') {
        stats.push(
          `每层 +${Math.round(CACHE_PASSIVE.perStack(1) * 100)}%~${Math.round(
            CACHE_PASSIVE.perStack(def.maxLevel) * 100,
          )}% 攻速`,
        );
        stats.push(`最多 ${CACHE_PASSIVE.maxStacks} 层 · ${CACHE_PASSIVE.window}s 重置`);
      } else if (passiveId === 'parallel') {
        stats.push(
          `交替命中 +${Math.round(PARALLEL_PASSIVE.bonus(1) * 100)}%~${Math.round(
            PARALLEL_PASSIVE.bonus(def.maxLevel) * 100,
          )}% 伤害`,
        );
        stats.push('同一目标切换武器触发');
      } else if (passiveId === 'gc') {
        stats.push(`${GC_PASSIVE.window}s 内连续拾取`);
        stats.push(
          `满 ${GC_PASSIVE.threshold(1)}→${GC_PASSIVE.threshold(def.maxLevel)} 球 · 清扫 ${Math.round(
            GC_PASSIVE.radius(1),
          )} 范围`,
        );
      } else if (passiveId === 'typesafe') {
        stats.push(
          `未受伤 ${TYPESAFE_PASSIVE.delay(1)}→${TYPESAFE_PASSIVE.delay(def.maxLevel)}s 生成`,
        );
        stats.push('抵挡一次伤害');
      }
      return {
        symbol: def.symbol,
        color: def.color,
        name: def.name,
        tagline: def.tagline,
        desc: `${def.desc} · ${def.note}`,
        stats,
      };
    });
  }

  private buildRow(): Phaser.GameObjects.Container {
    const height = this.rowHeight;
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
    const name = this.add.text(104, 12, '', {
      fontFamily: MONO_FONT,
      fontSize: '17px',
      color: hex(PALETTE.text),
      fontStyle: 'bold',
    });
    const tagline = this.add.text(0, 14, '', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: hex(PALETTE.textDim),
    });
    const desc = this.add.text(104, 36, '', {
      fontFamily: MONO_FONT,
      fontSize: '12px',
      color: hex(PALETTE.text),
      lineSpacing: 3,
    });
    const stats = this.add
      .text(this.rowWidth - 16, 12, '', {
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
    this.list.add(container);
    container.setData('bg', bg);
    container.setData('symbol', symbol);
    container.setData('accent', accent);
    container.setData('name', name);
    container.setData('tagline', tagline);
    container.setData('desc', desc);
    container.setData('stats', stats);
    return container;
  }

  private fillRow(container: Phaser.GameObjects.Container, entry: Entry): void {
    const bg = container.getData('bg') as Phaser.GameObjects.Rectangle;
    const symbol = container.getData('symbol') as Phaser.GameObjects.Text;
    const accent = container.getData('accent') as Phaser.GameObjects.Rectangle;
    const name = container.getData('name') as Phaser.GameObjects.Text;
    const tagline = container.getData('tagline') as Phaser.GameObjects.Text;
    const desc = container.getData('desc') as Phaser.GameObjects.Text;
    const stats = container.getData('stats') as Phaser.GameObjects.Text;
    const compact = this.compact;

    bg.setSize(this.rowWidth, this.rowHeight);
    accent.setSize(4, this.rowHeight);
    symbol.setPosition(compact ? 44 : 52, this.rowHeight / 2);
    symbol.setText(entry.symbol).setColor(hex(entry.color));
    symbol.setFontSize(entry.symbol.length > 4 ? 15 : entry.symbol.length > 2 ? 19 : 26);
    accent.setFillStyle(entry.color);

    name.setPosition(compact ? 88 : 104, compact ? 14 : 12).setText(entry.name);
    tagline
      .setPosition((compact ? 88 : 104) + name.width + 8, compact ? 16 : 14)
      .setText(entry.tagline);

    stats.setFontSize(compact ? 11 : 12);
    stats.setLineSpacing(compact ? 2 : 5);
    stats.setAlign(compact ? 'left' : 'right');
    stats.setOrigin(compact ? 0 : 1, 0);
    stats.setText(entry.stats.join(compact ? ' · ' : '\n'));
    stats.setWordWrapWidth(compact ? this.rowWidth - 104 : 10000);
    stats.setPosition(compact ? 88 : this.rowWidth - 16, compact ? 82 : 12);

    const descWidth = compact
      ? this.rowWidth - 104
      : this.rowWidth - 104 - stats.width - 24;
    const chars = Math.max(18, Math.floor(descWidth / 12));
    desc.setPosition(compact ? 88 : 104, 36);
    desc.setText(wrapDesc(entry.desc, chars, 3));
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
      scroll: Math.round(this.scroll),
      maxScroll: Math.round(this.maxScroll),
    };
  }
}
