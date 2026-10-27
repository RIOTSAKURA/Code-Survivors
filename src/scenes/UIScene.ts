import Phaser from 'phaser';
import { DPR, MONO_FONT, PALETTE } from '../config';
import { sfx } from '../core/audio';
import { applyTextResolution, setupFixedCamera, viewHeight, viewWidth } from '../core/hidpi';
import { formatTime, readBest, writeBest } from '../core/records';
import { EV, bus, hud } from '../core/state';
import type { UpgradeCard } from '../systems/progression';

interface LevelPayload {
  cards: UpgradeCard[];
  level: number;
  pending: number;
}

interface OverPayload {
  time: number;
  kills: number;
  level: number;
  weapons: number;
}

interface BannerPayload {
  text: string;
  sub: string;
  ms: number;
}

const CARD_W = 640;
const CARD_H = 92;
const CARD_GAP = 12;

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

class CardView {
  readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly accent: Phaser.GameObjects.Rectangle;
  private readonly symbol: Phaser.GameObjects.Text;
  private readonly name: Phaser.GameObjects.Text;
  private readonly level: Phaser.GameObjects.Text;
  private readonly desc: Phaser.GameObjects.Text;
  private readonly chip: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  readonly index: number;

  constructor(scene: Phaser.Scene, index: number, onPick: (index: number) => void) {
    this.index = index;
    const bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, 0x181825, 0.96).setOrigin(0);
    bg.setStrokeStyle(1, 0x45475a);
    const accent = scene.add.rectangle(0, 0, 4, CARD_H, PALETTE.green).setOrigin(0);
    const symbol = scene.add
      .text(46, CARD_H / 2, '', { fontFamily: MONO_FONT, fontSize: '24px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5);
    const name = scene.add
      .text(88, 26, '', { fontFamily: MONO_FONT, fontSize: '19px', color: '#cdd6f4', fontStyle: 'bold' })
      .setOrigin(0, 0.5);
    const level = scene.add
      .text(0, 26, '', { fontFamily: MONO_FONT, fontSize: '14px', color: '#7f849c' })
      .setOrigin(0, 0.5);
    const desc = scene.add
      .text(88, 60, '', { fontFamily: MONO_FONT, fontSize: '14px', color: '#a6adc8' })
      .setOrigin(0, 0.5);
    const chip = scene.add
      .text(CARD_W - 66, 26, '', { fontFamily: MONO_FONT, fontSize: '12px', color: '#1e1e2e', fontStyle: 'bold' })
      .setOrigin(0.5);
    chip.setPadding(6, 3, 6, 3);
    const hint = scene.add
      .text(CARD_W - 22, CARD_H / 2, `[${index + 1}]`, {
        fontFamily: MONO_FONT,
        fontSize: '18px',
        color: '#7f849c',
      })
      .setOrigin(1, 0.5);

    for (const t of [symbol, name, level, desc, chip, hint]) t.setResolution(DPR);
    this.container = scene.add.container(0, 0, [bg, accent, symbol, name, level, desc, chip, hint]);
    this.container.setSize(CARD_W, CARD_H);
    this.container.setInteractive(
      new Phaser.Geom.Rectangle(CARD_W / 2, CARD_H / 2, CARD_W, CARD_H),
      Phaser.Geom.Rectangle.Contains,
    );
    this.container.on('pointerover', () => {
      bg.setFillStyle(0x232338, 0.98);
      bg.setStrokeStyle(1, 0x89b4fa);
    });
    this.container.on('pointerout', () => {
      bg.setFillStyle(0x181825, 0.96);
      bg.setStrokeStyle(1, 0x45475a);
    });
    this.container.on('pointerdown', () => onPick(index));

    this.bg = bg;
    this.accent = accent;
    this.symbol = symbol;
    this.name = name;
    this.level = level;
    this.desc = desc;
    this.chip = chip;
    this.hint = hint;
  }

  set(card: UpgradeCard | null, visible: boolean): void {
    this.container.setVisible(visible);
    if (!card) return;
    this.accent.setFillStyle(card.color);
    this.symbol.setText(card.symbol).setColor(hex(card.color));
    if (card.symbol.length > 5) this.symbol.setFontSize(16);
    else if (card.symbol.length > 2) this.symbol.setFontSize(20);
    else this.symbol.setFontSize(26);
    this.name.setText(card.name);
    const levelText =
      card.level === 0
        ? card.kind === 'weapon'
          ? 'NEW WEAPON'
          : 'NEW PASSIVE'
        : `Lv ${card.level} → ${card.nextLevel}`;
    this.level.setText(`  ${levelText}`).setX(88 + this.name.width + 10);
    this.desc.setText(card.desc);
    if (card.maxed) {
      this.chip.setText('MAX').setBackgroundColor('#7f849c');
    } else if (card.isNew) {
      this.chip.setText('NEW').setBackgroundColor(hex(card.color));
    } else {
      this.chip.setText('UP').setBackgroundColor(hex(card.color));
    }
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  setAlpha(value: number): void {
    this.container.setAlpha(value);
  }

  destroy(): void {
    this.container.destroy();
    void this.bg;
    void this.hint;
  }
}

export class UIScene extends Phaser.Scene {
  private xpBarBg!: Phaser.GameObjects.Rectangle;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private statText!: Phaser.GameObjects.Text;
  private loadoutText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private vignette!: Phaser.GameObjects.Graphics;
  private bossName!: Phaser.GameObjects.Text;
  private bossBarBg!: Phaser.GameObjects.Rectangle;
  private bossBarFill!: Phaser.GameObjects.Rectangle;

  private panel!: Phaser.GameObjects.Container;
  private panelHeader!: Phaser.GameObjects.Text;
  private panelFooter!: Phaser.GameObjects.Text;
  private cards: CardView[] = [];

  private overPanel!: Phaser.GameObjects.Container;
  private overTitle!: Phaser.GameObjects.Text;
  private overBody!: Phaser.GameObjects.Text;
  private overHint!: Phaser.GameObjects.Text;

  private pausePanel!: Phaser.GameObjects.Container;
  private confirmPanel!: Phaser.GameObjects.Container;
  private confirmBody!: Phaser.GameObjects.Text;
  private confirmYes!: Phaser.GameObjects.Text;
  private confirmNo!: Phaser.GameObjects.Text;

  private bannerTimer = 0;
  private vignetteAlpha = -1;
  private cachedLoadout = '';
  private cachedHp = '';
  private cachedStats = '';
  private cachedTimer = '';
  private overVisible = false;

  constructor() {
    super('UI');
  }

  create(): void {
    setupFixedCamera(this.cameras.main);

    this.xpBarBg = this.add.rectangle(0, 0, 10, 5, 0x313244).setOrigin(0);
    this.xpBarFill = this.add.rectangle(0, 0, 0, 5, PALETTE.green).setOrigin(0);

    this.hpText = this.add.text(16, 16, '', {
      fontFamily: MONO_FONT,
      fontSize: '18px',
      color: '#cdd6f4',
      fontStyle: 'bold',
    });
    this.statText = this.add.text(16, 42, '', {
      fontFamily: MONO_FONT,
      fontSize: '15px',
      color: '#a6adc8',
    });
    this.loadoutText = this.add.text(16, 66, '', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: '#7f849c',
      lineSpacing: 4,
    });
    this.timerText = this.add
      .text(0, 14, '00:00', { fontFamily: MONO_FONT, fontSize: '30px', color: '#cdd6f4', fontStyle: 'bold' })
      .setOrigin(0.5, 0);
    this.killsText = this.add
      .text(0, 20, '', { fontFamily: MONO_FONT, fontSize: '16px', color: '#ffa500' })
      .setOrigin(1, 0);
    this.hintText = this.add
      .text(0, 0, 'WASD move   P pause   M mute', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: '#585b70',
      })
      .setOrigin(0.5, 1);

    this.bossBarBg = this.add.rectangle(0, 0, 460, 14, 0x2b1a24).setOrigin(0.5).setVisible(false);
    this.bossBarBg.setStrokeStyle(1, PALETTE.red);
    this.bossBarFill = this.add.rectangle(0, 0, 460, 14, PALETTE.red).setOrigin(0, 0.5).setVisible(false);
    this.bossName = this.add
      .text(0, 0, '', { fontFamily: MONO_FONT, fontSize: '14px', color: '#ff2d55', fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setVisible(false);

    this.bannerText = this.add
      .text(0, 0, '', { fontFamily: MONO_FONT, fontSize: '26px', color: '#00ffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setAlpha(0);
    this.bannerSub = this.add
      .text(0, 0, '', { fontFamily: MONO_FONT, fontSize: '14px', color: '#7f849c' })
      .setOrigin(0.5)
      .setAlpha(0);

    this.vignette = this.add.graphics();

    this.buildPanel();
    this.buildOverPanel();
    this.buildPausePanel();
    this.buildConfirmPanel();

    this.wireEvents();
    applyTextResolution(this);
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  private buildPanel(): void {
    const header = this.add
      .text(0, 0, '▸ upgrade_available.rs — choose 1 of 3', {
        fontFamily: MONO_FONT,
        fontSize: '16px',
        color: '#00ff41',
      })
      .setOrigin(0.5, 0);
    const footer = this.add
      .text(0, 0, 'press [1] [2] [3] or click a suggestion · build the strongest module set', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: '#7f849c',
      })
      .setOrigin(0.5, 1);
    this.panelHeader = header;
    this.panelFooter = footer;
    this.cards = [0, 1, 2].map((i) => new CardView(this, i, (index) => this.pick(index)));
    this.panel = this.add.container(0, 0, [header, footer, ...this.cards.map((c) => c.container)]);
    this.panel.setVisible(false);
  }

  private buildOverPanel(): void {
    const bg = this.add.rectangle(0, 0, 560, 260, 0x11111b, 0.94).setOrigin(0.5);
    bg.setStrokeStyle(1, PALETTE.red);
    this.overTitle = this.add
      .text(0, -92, 'PROCESS TERMINATED', {
        fontFamily: MONO_FONT,
        fontSize: '30px',
        color: '#ff0040',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.overBody = this.add
      .text(0, 6, '', {
        fontFamily: MONO_FONT,
        fontSize: '16px',
        color: '#cdd6f4',
        align: 'center',
        lineSpacing: 8,
      })
      .setOrigin(0.5);
    this.overHint = this.add
      .text(0, 108, '[R] redeploy    [Q] quit to shell', {
        fontFamily: MONO_FONT,
        fontSize: '15px',
        color: '#ffe066',
      })
      .setOrigin(0.5);
    this.overPanel = this.add.container(0, 0, [bg, this.overTitle, this.overBody, this.overHint]);
    this.overPanel.setVisible(false);
  }

  private buildPausePanel(): void {
    const bg = this.add.rectangle(0, 0, 420, 150, 0x11111b, 0.9).setOrigin(0.5);
    bg.setStrokeStyle(1, 0x89b4fa);
    const title = this.add
      .text(0, -34, 'PAUSED', { fontFamily: MONO_FONT, fontSize: '26px', color: '#89b4fa', fontStyle: 'bold' })
      .setOrigin(0.5);
    const body = this.add
      .text(0, 18, 'P / ESC resume\nQ quit to shell', {
        fontFamily: MONO_FONT,
        fontSize: '15px',
        color: '#a6adc8',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);
    this.pausePanel = this.add.container(0, 0, [bg, title, body]);
    this.pausePanel.setVisible(false);
  }

  private buildConfirmPanel(): void {
    const bg = this.add.rectangle(0, 0, 560, 250, 0x11111b, 0.96).setOrigin(0.5);
    bg.setStrokeStyle(1, 0xffa500);
    const title = this.add
      .text(0, -88, 'EXIT TO SHELL?', {
        fontFamily: MONO_FONT,
        fontSize: '24px',
        color: '#ffa500',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const line = this.add
      .text(0, -52, '本局将立即结算，更好的成绩会保留在最佳纪录里', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: '#a6adc8',
      })
      .setOrigin(0.5);
    this.confirmBody = this.add
      .text(0, -6, '', {
        fontFamily: MONO_FONT,
        fontSize: '16px',
        color: '#cdd6f4',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);
    this.confirmYes = this.add
      .text(-120, 74, '[Y] 确认退出', {
        fontFamily: MONO_FONT,
        fontSize: '16px',
        color: '#00ff41',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.confirmNo = this.add
      .text(120, 74, '[N] 取消', {
        fontFamily: MONO_FONT,
        fontSize: '16px',
        color: '#7f849c',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.confirmYes.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.confirmQuit());
    this.confirmNo.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.cancelQuit());
    this.confirmPanel = this.add.container(0, 0, [bg, title, line, this.confirmBody, this.confirmYes, this.confirmNo]);
    this.confirmPanel.setVisible(false);
  }

  private requestQuit(): void {
    hud.confirming = true;
    this.confirmBody.setText(
      `存活 ${formatTime(hud.time)} · 击杀 ${hud.kills} · LVL ${hud.level}`,
    );
    this.pausePanel.setVisible(false);
    this.confirmPanel.setVisible(true);
  }

  private cancelQuit(): void {
    hud.confirming = false;
    this.confirmPanel.setVisible(false);
    this.pausePanel.setVisible(hud.paused && !this.overVisible && !hud.gameOver && !hud.confirming);
  }

  private confirmQuit(): void {
    hud.confirming = false;
    this.confirmPanel.setVisible(false);
    this.quitToMenu();
  }

  private wireEvents(): void {
    const registered: Array<[string, (payload: unknown) => void]> = [];
    const on = <T>(event: string, fn: (payload: T) => void) => {
      bus.on(event, fn);
      registered.push([event, fn as (payload: unknown) => void]);
    };

    on<LevelPayload>(EV.levelUp, (payload) => this.showLevelUp(payload));
    on<OverPayload>(EV.gameOver, (payload) => this.showGameOver(payload));
    on<BannerPayload>(EV.banner, (payload) => this.showBanner(payload));
    on(EV.sfxToggle, () => {
      const enabled = sfx.toggle();
      this.showBanner({ text: enabled ? 'audio on' : 'audio muted', sub: '', ms: 800 });
    });
    on(EV.restart, () => this.hideOverlay());
    this.events.once('shutdown', () => {
      for (const [event, fn] of registered) bus.off(event, fn);
    });

    this.input.keyboard!.on('keydown-ONE', () => this.pick(0));
    this.input.keyboard!.on('keydown-TWO', () => this.pick(1));
    this.input.keyboard!.on('keydown-THREE', () => this.pick(2));
    this.input.keyboard!.on('keydown-R', () => {
      if (this.overVisible) this.restart();
    });
    this.input.keyboard!.on('keydown-Q', () => {
      if (hud.confirming) {
        this.cancelQuit();
        return;
      }
      if (this.overVisible) {
        this.quitToMenu();
        return;
      }
      if (hud.paused) this.requestQuit();
    });
    this.input.keyboard!.on('keydown-Y', () => {
      if (hud.confirming) this.confirmQuit();
    });
    this.input.keyboard!.on('keydown-N', () => {
      if (hud.confirming) this.cancelQuit();
    });
  }

  private pick(index: number): void {
    if (!this.panel.visible) return;
    bus.emit(EV.choicePicked, { index });
    this.panel.setVisible(false);
  }

  private restart(): void {
    this.hideOverlay();
    bus.emit(EV.restart, undefined);
  }

  private quitToMenu(): void {
    if (!this.overVisible && hud.time > 0) {
      writeBest({ time: hud.time, kills: hud.kills, level: hud.level });
    }
    this.hideOverlay();
    this.scene.stop('Game');
    this.scene.stop('UI');
    this.scene.start('Menu');
  }

  private hideOverlay(): void {
    this.overVisible = false;
    hud.confirming = false;
    this.overPanel.setVisible(false);
    this.panel.setVisible(false);
    this.pausePanel.setVisible(false);
    this.confirmPanel.setVisible(false);
  }

  private showLevelUp(payload: LevelPayload): void {
    this.pausePanel.setVisible(false);
    this.panel.setVisible(true);
    this.cards.forEach((card, i) => {
      const data = payload.cards[i] ?? null;
      card.set(data, data !== null);
    });
    this.panelHeader.setText(
      `▸ upgrade_available.rs — LVL ${payload.level}${payload.pending > 1 ? ` (${payload.pending} pending)` : ''}`,
    );
    this.layout();
    this.cards.forEach((card, i) => {
      card.setAlpha(0);
      this.tweens.add({ targets: card.container, alpha: 1, duration: 180, delay: i * 60 });
    });
  }

  private showBanner(payload: BannerPayload): void {
    const fatal = payload.text.includes('FATAL');
    this.bannerText.setText(payload.text);
    this.bannerSub.setText(payload.sub);
    this.bannerText.setFontSize(fatal ? 40 : 26);
    this.bannerSub.setFontSize(fatal ? 16 : 14);
    this.bannerText.setColor(fatal ? '#ff0040' : '#00ffff');
    this.bannerTimer = (payload.ms ?? 1200) / 1000;
    this.bannerText.setAlpha(1);
    this.bannerSub.setAlpha(1);
    this.bannerText.setScale(0.9);
    this.tweens.add({ targets: this.bannerText, scale: 1, duration: 160, ease: 'Back.out' });
  }

  private showGameOver(payload: OverPayload): void {
    const isRecord = writeBest({ time: payload.time, kills: payload.kills, level: payload.level });
    const best = readBest();
    this.overVisible = true;
    this.overTitle.setText(isRecord ? 'NEW RECORD' : 'PROCESS TERMINATED');
    this.overTitle.setColor(isRecord ? '#00ff41' : '#ff0040');
    this.overBody.setText(
      [
        `survived   ${formatTime(payload.time)}`,
        `kills      ${payload.kills}`,
        `level      ${payload.level}`,
        `modules    ${payload.weapons}/6`,
        best ? `best       ${formatTime(best.time)} · ${best.kills} kills` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    this.overPanel.setVisible(true);
    this.overPanel.setAlpha(0);
    this.tweens.add({ targets: this.overPanel, alpha: 1, duration: 320 });
    this.panel.setVisible(false);
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.tweens.add({
          targets: [this.bannerText, this.bannerSub],
          alpha: 0,
          duration: 320,
        });
      }
    }

    if (hud.damageFlash > 0) hud.damageFlash = Math.max(0, hud.damageFlash - dt * 2.6);

    const hpText =
      hud.hp <= 0
        ? 'HP: ░░░░░░░░░░ DEAD'
        : `HP: ${'█'.repeat(Math.round((hud.hp / hud.maxHp) * 10)).padEnd(10, '░')} ${Math.round(
            (hud.hp / hud.maxHp) * 100,
          )}%`;
    if (hpText !== this.cachedHp) {
      this.cachedHp = hpText;
      this.hpText.setText(hpText);
      const ratio = hud.hp / hud.maxHp;
      this.hpText.setColor(ratio > 0.6 ? '#00ff41' : ratio > 0.3 ? '#ffe066' : '#ff0040');
    }

    const stats = `LVL: ${hud.level}   XP: ${Math.floor(hud.xp)}/${hud.xpNeed}   KILLS: ${hud.kills}`;
    if (stats !== this.cachedStats) {
      this.cachedStats = stats;
      this.statText.setText(stats);
    }

    const loadout = [
      `weapons ${hud.weapons.map((w) => `${w.symbol}L${w.level}${w.max ? '*' : ''}`).join(' ') || '—'}`,
      `passive ${hud.passives.map((p) => `${p.symbol}L${p.level}${p.max ? '*' : ''}`).join(' ') || '—'}`,
    ].join('\n');
    if (loadout !== this.cachedLoadout) {
      this.cachedLoadout = loadout;
      this.loadoutText.setText(loadout);
    }

    const timer = formatTime(hud.time);
    if (timer !== this.cachedTimer) {
      this.cachedTimer = timer;
      this.timerText.setText(timer);
    }
    this.killsText.setText(`kills ${hud.kills}`);

    const xpRatio = Math.max(0, Math.min(1, hud.xp / Math.max(1, hud.xpNeed)));
    this.xpBarFill.width = viewWidth(this.cameras.main) * xpRatio;

    this.pausePanel.setVisible(hud.paused && !this.overVisible && !hud.gameOver && !hud.confirming);

    if (hud.boss && !this.overVisible) {
      const ratio = Math.max(0, hud.boss.hp / hud.boss.maxHp);
      this.bossBarBg.setVisible(true);
      this.bossBarFill.setVisible(true);
      this.bossName.setVisible(true);
      this.bossName.setText(`${hud.boss.name}  ·  PHASE ${hud.boss.phase}`);
      this.bossBarFill.width = 458 * ratio;
    } else {
      this.bossBarBg.setVisible(false);
      this.bossBarFill.setVisible(false);
      this.bossName.setVisible(false);
    }

    const hurt = Math.max(hud.damageFlash, hud.hp / hud.maxHp < 0.3 ? 0.35 + 0.15 * Math.sin(hud.time * 6) : 0);
    const quantized = Math.round(hurt * 20) / 20;
    if (quantized !== this.vignetteAlpha) {
      this.vignetteAlpha = quantized;
      this.drawVignette(quantized);
    }
  }

  private drawVignette(alpha: number): void {
    const g = this.vignette;
    g.clear();
    if (alpha <= 0.01) return;
    const w = viewWidth(this.cameras.main);
    const h = viewHeight(this.cameras.main);
    const thickness = 46;
    g.fillStyle(PALETTE.red, Math.min(0.42, alpha * 0.34));
    g.fillRect(0, 0, w, thickness);
    g.fillRect(0, h - thickness, w, thickness);
    g.fillRect(0, 0, thickness, h);
    g.fillRect(w - thickness, 0, thickness, h);
  }

  private layout(): void {
    const w = viewWidth(this.cameras.main);
    const h = viewHeight(this.cameras.main);

    this.xpBarBg.setSize(w, 5);
    this.xpBarBg.setPosition(0, 0);
    this.xpBarFill.setPosition(0, 0);

    this.timerText.setPosition(w / 2, 12);
    this.killsText.setPosition(w - 18, 22);
    this.hintText.setPosition(w / 2, h - 10);

    const cardTotal = CARD_H * 3 + CARD_GAP * 2;
    const panelTop = h / 2 - cardTotal / 2;
    this.panelHeader.setPosition(w / 2, panelTop - 42);
    this.panelFooter.setPosition(w / 2, panelTop + cardTotal + 36);
    this.cards.forEach((card, i) => {
      card.setPosition(w / 2 - CARD_W / 2, panelTop + i * (CARD_H + CARD_GAP));
    });
    this.panel.setPosition(0, 0);

    this.overPanel.setPosition(w / 2, h / 2);
    this.pausePanel.setPosition(w / 2, h / 2);
    this.confirmPanel.setPosition(w / 2, h / 2);
    this.bannerText.setPosition(w / 2, h * 0.2);
    this.bannerSub.setPosition(w / 2, h * 0.2 + 30);

    const bossY = h - 74;
    this.bossBarBg.setPosition(w / 2, bossY);
    this.bossBarFill.setPosition(w / 2 - 229, bossY);
    this.bossName.setPosition(w / 2, bossY - 10);

    this.vignetteAlpha = -1;
  }
}
