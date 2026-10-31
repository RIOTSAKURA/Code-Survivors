import Phaser from 'phaser';
import { DPR, MONO_FONT, PALETTE } from '../config';
import { sfx } from '../core/audio';
import { applyTextResolution, setupFixedCamera, viewHeight, viewWidth } from '../core/hidpi';
import { formatTime, writeBest } from '../core/records';
import { EV, bus, hud } from '../core/state';
import type { RunReport } from '../core/state';
import type { ChoiceCard } from '../systems/progression';
import { recapJsonText, reportText } from '../systems/recap';

interface LevelPayload {
  cards: ChoiceCard[];
  level: number;
  pending: number;
  title?: string;
  footer?: string;
}

type OverPayload = RunReport;

interface BannerPayload {
  text: string;
  sub: string;
  ms: number;
  color?: string;
  emphasis?: boolean;
}

const CARD_W = 640;
const CARD_H = 92;
const CARD_GAP = 12;
const PANEL_FOOTER = 'press [1] [2] [3] or click a suggestion · build the strongest module set';

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
  private readonly synergy: Phaser.GameObjects.Text;
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
    const synergy = scene.add
      .text(88, 74, '', { fontFamily: MONO_FONT, fontSize: '11px', color: '#ffe066' })
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

    for (const t of [symbol, name, level, desc, synergy, chip, hint]) t.setResolution(DPR);
    this.container = scene.add.container(0, 0, [bg, accent, symbol, name, level, desc, synergy, chip, hint]);
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
    this.synergy = synergy;
    this.chip = chip;
    this.hint = hint;
  }

  set(card: ChoiceCard | null, visible: boolean): void {
    this.container.setVisible(visible);
    if (!card) return;
    this.accent.setFillStyle(card.color);
    this.symbol.setText(card.symbol).setColor(hex(card.color));
    if (card.symbol.length > 5) this.symbol.setFontSize(16);
    else if (card.symbol.length > 2) this.symbol.setFontSize(20);
    else this.symbol.setFontSize(26);
    this.name.setText(card.name);
    const levelText =
      card.label ??
      (card.level === 0
        ? card.kind === 'weapon'
          ? 'NEW WEAPON'
          : 'NEW PASSIVE'
        : `Lv ${card.level} → ${card.nextLevel}`);
    this.level.setText(`  ${levelText}`).setX(88 + this.name.width + 10);
    this.desc.setText(card.desc);
    this.desc.setY(card.synergy ? 46 : 60);
    this.synergy.setVisible(Boolean(card.synergy));
    this.synergy.setText(card.synergy ?? '');
    if (card.chip) {
      this.chip.setText(card.chip).setBackgroundColor(hex(card.color));
    } else if (card.maxed) {
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
  private zoneText!: Phaser.GameObjects.Text;
  private themeText!: Phaser.GameObjects.Text;
  private focusText!: Phaser.GameObjects.Text;
  private objectivePanel!: Phaser.GameObjects.Container;
  private objectiveBg!: Phaser.GameObjects.Rectangle;
  private objectiveAccent!: Phaser.GameObjects.Rectangle;
  private objectiveTitle!: Phaser.GameObjects.Text;
  private objectivePrompt!: Phaser.GameObjects.Text;
  private objectiveBarFill!: Phaser.GameObjects.Rectangle;
  private passiveText!: Phaser.GameObjects.Text;
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
  private overBg!: Phaser.GameObjects.Rectangle;
  private overTitle!: Phaser.GameObjects.Text;
  private overFile!: Phaser.GameObjects.Text;
  private jsonBody!: Phaser.GameObjects.Container;
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
  private cachedObjective = '';
  private cachedPassive = '';
  private cachedTheme = '';
  private cachedFocus = '';
  private overVisible = false;
  private victoryVisible = false;
  private report: RunReport | null = null;

  constructor() {
    super('UI');
  }

  create(): void {
    (window as unknown as { __report?: RunReport }).__report = undefined;
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
    this.zoneText = this.add.text(16, 112, '', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: '#00ff41',
    });
    this.zoneText.setVisible(false);
    this.passiveText = this.add.text(16, 134, '', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: '#a6adc8',
    });
    this.passiveText.setVisible(false);
    this.themeText = this.add.text(16, 156, '', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: '#ffa500',
      fontStyle: 'bold',
    });
    this.themeText.setVisible(false);
    this.focusText = this.add.text(16, 178, '', {
      fontFamily: MONO_FONT,
      fontSize: '13px',
      color: '#ffe066',
    });
    this.focusText.setVisible(false);
    this.timerText = this.add
      .text(0, 14, '00:00', { fontFamily: MONO_FONT, fontSize: '30px', color: '#cdd6f4', fontStyle: 'bold' })
      .setOrigin(0.5, 0);
    this.killsText = this.add
      .text(0, 20, '', { fontFamily: MONO_FONT, fontSize: '16px', color: '#ffa500' })
      .setOrigin(1, 0);
    this.hintText = this.add
      .text(0, 0, 'WASD move   E interact   F focus   P pause   M mute', {
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

    this.buildObjectivePanel();
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

  private buildObjectivePanel(): void {
    const bg = this.add.rectangle(0, 0, 560, 62, 0x11111b, 0.92).setStrokeStyle(1, PALETTE.cyan);
    const accent = this.add.rectangle(-280, 0, 4, 62, PALETTE.cyan).setOrigin(0, 0.5);
    const title = this.add
      .text(-260, -12, '', {
        fontFamily: MONO_FONT,
        fontSize: '16px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);
    const prompt = this.add
      .text(-260, 12, '', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: '#ffe066',
      })
      .setOrigin(0, 0.5);
    const barBg = this.add.rectangle(-260, 27, 520, 4, 0x313244).setOrigin(0, 0.5);
    const barFill = this.add.rectangle(-260, 27, 0, 4, PALETTE.cyan).setOrigin(0, 0.5);
    this.objectiveBg = bg;
    this.objectiveAccent = accent;
    this.objectiveTitle = title;
    this.objectivePrompt = prompt;
    this.objectiveBarFill = barFill;
    this.objectivePanel = this.add
      .container(0, 0, [bg, accent, title, prompt, barBg, barFill])
      .setVisible(false);
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
      .text(0, 0, PANEL_FOOTER, {
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
    const bg = this.add.rectangle(0, 0, 900, 560, 0x11111b, 1).setOrigin(0.5);
    bg.setStrokeStyle(1, PALETTE.red);
    this.overBg = bg;
    const chrome = this.add.rectangle(0, -252, 900, 32, 0x181825, 0.98).setOrigin(0.5);
    chrome.setStrokeStyle(1, 0x313244);
    this.overFile = this.add
      .text(-420, -252, '~/code-survivors/run/recap.json', {
        fontFamily: MONO_FONT,
        fontSize: '12px',
        color: '#7f849c',
      })
      .setOrigin(0, 0.5);
    const badge = this.add
      .text(420, -252, 'JSON', {
        fontFamily: MONO_FONT,
        fontSize: '11px',
        color: '#1e1e2e',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0.5);
    badge.setPadding(7, 2, 7, 2).setBackgroundColor('#00ffff');
    this.overTitle = this.add
      .text(0, -204, 'PROCESS TERMINATED', {
        fontFamily: MONO_FONT,
        fontSize: '24px',
        color: '#ff0040',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.jsonBody = this.add.container(0, 0);
    this.overHint = this.add
      .text(0, 252, '[R] redeploy    [C] copy JSON    [Q] quit to shell', {
        fontFamily: MONO_FONT,
        fontSize: '13px',
        color: '#ffe066',
      })
      .setOrigin(0.5);
    this.overPanel = this.add.container(0, 0, [
      bg,
      chrome,
      this.overFile,
      badge,
      this.overTitle,
      this.jsonBody,
      this.overHint,
    ]);
    this.overPanel.setVisible(false);
  }

  private renderRecapJson(text: string): void {
    this.jsonBody.removeAll(true);
    const lines = text.split('\n');
    const x = -420;
    const contentX = -386;
    const top = -166;
    const step = 15;
    lines.forEach((line, index) => {
      const y = top + index * step;
      const number = this.add
        .text(x, y, String(index + 1).padStart(2, '0'), {
          fontFamily: MONO_FONT,
          fontSize: '10px',
          color: '#45475a',
        })
        .setOrigin(0, 0)
        .setResolution(DPR);
      this.jsonBody.add(number);
      const match = line.match(/^(\s*)"([^"]+)":\s*(.*)$/);
      if (match) {
        const key = this.add
          .text(contentX, y, `${match[1]}"${match[2]}":`, {
            fontFamily: MONO_FONT,
            fontSize: '12px',
            color: '#89b4fa',
          })
          .setOrigin(0, 0)
          .setResolution(DPR);
        const valueColor =
          match[2] === 'result'
            ? match[3].includes('SHIPPED')
              ? '#00ff41'
              : '#ff0040'
            : this.jsonValueColor(match[3]);
        const value = this.add
          .text(contentX + key.width + 4, y, match[3], {
            fontFamily: MONO_FONT,
            fontSize: '12px',
            color: valueColor,
          })
          .setOrigin(0, 0)
          .setResolution(DPR);
        this.jsonBody.add([key, value]);
        return;
      }
      const trimmed = line.trim();
      const color = /^[{}[\],]+$/.test(trimmed) ? '#585b70' : this.jsonValueColor(line);
      const content = this.add
        .text(contentX, y, line, {
          fontFamily: MONO_FONT,
          fontSize: '12px',
          color,
        })
        .setOrigin(0, 0)
        .setResolution(DPR);
      this.jsonBody.add(content);
    });
  }

  private jsonValueColor(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('"')) return '#a6e3a1';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return '#89dceb';
    if (/^-?\d/.test(trimmed)) return '#f9e2af';
    if (trimmed.startsWith('true') || trimmed.startsWith('false')) return '#cba6f7';
    return '#a6adc8';
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
    on<OverPayload>(EV.gameOver, (payload) => this.showRunReport(payload, false));
    on<OverPayload>(EV.victory, (payload) => this.showRunReport(payload, true));
    on(EV.endless, () => this.hideOverlay());
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
      if (this.panel.visible && (hud.panel === 'level' || hud.panel === 'free')) {
        bus.emit(EV.choiceAction, { action: 'reroll' });
        return;
      }
      if (this.victoryVisible) {
        this.continueEndless();
        return;
      }
      if (this.overVisible) this.restart();
    });
    this.input.keyboard!.on('keydown-X', () => {
      if (this.panel.visible && (hud.panel === 'level' || hud.panel === 'free') && hud.skips > 0) {
        bus.emit(EV.choiceAction, { action: 'skip' });
        this.panel.setVisible(false);
      }
    });
    this.input.keyboard!.on('keydown-C', () => {
      if (this.overVisible) void this.copyRecap();
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
    const card = this.cards[index];
    if (!card || !card.container.visible) return;
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
    this.scene.stop('Codex');
    this.scene.stop('Game');
    this.scene.stop('UI');
    this.scene.start('Menu');
  }

  private hideOverlay(): void {
    this.overVisible = false;
    this.victoryVisible = false;
    this.report = null;
    hud.victory = false;
    hud.confirming = false;
    this.overPanel.setVisible(false);
    this.jsonBody.removeAll(true);
    this.panel.setVisible(false);
    this.pausePanel.setVisible(false);
    this.confirmPanel.setVisible(false);
  }

  private showLevelUp(payload: LevelPayload): void {
    this.pausePanel.setVisible(false);
    this.bannerTimer = 0;
    this.bannerText.setAlpha(0);
    this.bannerSub.setAlpha(0);
    this.panel.setVisible(true);
    this.cards.forEach((card, i) => {
      const data = payload.cards[i] ?? null;
      card.set(data, data !== null);
    });
    this.panelHeader.setText(
      payload.title ??
        `▸ upgrade_available.rs — LVL ${payload.level}${payload.pending > 1 ? ` (${payload.pending} pending)` : ''}`,
    );
    this.panelFooter.setText(payload.footer ?? PANEL_FOOTER);
    this.layout();
    this.cards.forEach((card, i) => {
      card.setAlpha(0);
      this.tweens.add({ targets: card.container, alpha: 1, duration: 180, delay: i * 60 });
    });
  }

  private showBanner(payload: BannerPayload): void {
    const fatal = payload.text.includes('FATAL');
    const emphasis = payload.emphasis ?? fatal;
    this.bannerText.setText(payload.text);
    this.bannerSub.setText(payload.sub);
    this.bannerText.setFontSize(emphasis ? 38 : 26);
    this.bannerSub.setFontSize(emphasis ? 16 : 14);
    this.bannerText.setColor(payload.color ?? (fatal ? '#ff0040' : '#00ffff'));
    this.bannerTimer = (payload.ms ?? 1200) / 1000;
    this.bannerText.setAlpha(1);
    this.bannerSub.setAlpha(1);
    this.bannerText.setScale(0.9);
    this.tweens.add({ targets: this.bannerText, scale: 1, duration: 160, ease: 'Back.out' });
  }

  private showRunReport(payload: OverPayload, victory: boolean): void {
    const isRecord = writeBest({ time: payload.time, kills: payload.kills, level: payload.level });
    this.report = payload;
    (window as unknown as { __report?: RunReport }).__report = payload;
    this.overVisible = true;
    this.victoryVisible = victory;
    this.bannerTimer = 0;
    this.bannerText.setAlpha(0);
    this.bannerSub.setAlpha(0);
    this.overTitle.setText(
      victory ? 'STACK SHIPPED' : isRecord ? 'NEW RECORD' : 'PROCESS TERMINATED',
    );
    this.overTitle.setColor(victory || isRecord ? '#00ff41' : '#ff0040');
    const json = recapJsonText(payload);
    this.renderRecapJson(json);
    (window as unknown as { __reportJson?: string }).__reportJson = json;
    this.overBg.setStrokeStyle(1, victory || isRecord ? PALETTE.green : PALETTE.red);
    this.overHint.setText(
      victory
        ? '[R] endless mode    [C] copy JSON    [Q] quit to shell'
        : '[R] redeploy    [C] copy JSON    [Q] quit to shell',
    );
    this.overPanel.setVisible(true);
    this.overPanel.setAlpha(0);
    this.tweens.add({ targets: this.overPanel, alpha: 1, duration: 320 });
    this.panel.setVisible(false);
    hud.victory = victory;
  }

  private continueEndless(): void {
    this.hideOverlay();
    bus.emit(EV.endless, undefined);
  }

  private async copyRecap(): Promise<void> {
    if (!this.report) return;
    const text = reportText(this.report);
    try {
      await navigator.clipboard.writeText(text);
      this.showBanner({ text: 'recap copied', sub: 'paste it anywhere to share the build', ms: 1100 });
    } catch {
      this.showBanner({ text: 'clipboard blocked', sub: 'screenshot the panel instead', ms: 1100 });
    }
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
      `weapons ${
        hud.weapons
          .map((w) => `${w.symbol}L${w.level}${w.max ? '*' : ''}${w.evolution ? `/${w.evolution}` : ''}`)
          .join(' ') || '—'
      }`,
      `passive ${hud.passives.map((p) => `${p.symbol}L${p.level}${p.max ? '*' : ''}`).join(' ') || '—'}`,
    ].join('\n');
    if (loadout !== this.cachedLoadout) {
      this.cachedLoadout = loadout;
      this.loadoutText.setText(loadout);
    }

    if (hud.zone) {
      const percent = Math.round(hud.zone.charge * 100);
      this.zoneText.setVisible(true);
      this.zoneText.setText(
        `◈ ${hud.zone.label} ${hud.zone.name} ${hud.zone.good ? percent : ''}%`.replace(' %', '%'),
      );
      this.zoneText.setColor(hud.zone.good ? (hud.zone.charge > 0.4 ? '#00ff41' : '#7f849c') : '#ffa500');
    } else {
      this.zoneText.setVisible(false);
    }

    const event = hud.events?.[0] ?? null;
    if (!event || this.overVisible || hud.gameOver || hud.boss) {
      this.objectivePanel.setVisible(false);
      this.cachedObjective = '';
    } else {
      this.objectivePanel.setVisible(true);
      this.objectiveBg.setStrokeStyle(1, event.color, 0.9);
      this.objectiveAccent.setFillStyle(event.color);
      this.objectiveTitle.setColor(hex(event.color)).setText(`${event.label} ${event.name}`);
      const label = event.active ? this.objectiveActiveLabel(event) : `[E] 接受 · ${event.detail}`;
      if (label !== this.cachedObjective) {
        this.cachedObjective = label;
        this.objectivePrompt.setText(label);
      }
      this.objectivePrompt.setColor(event.active ? '#cdd6f4' : '#ffe066');
      this.objectivePrompt.setAlpha(
        event.interactable ? 0.55 + 0.45 * Math.sin(this.time.now / 140) : 1,
      );
      this.objectiveBarFill.setFillStyle(event.color);
      this.objectiveBarFill.width = 520 * event.progress;
    }

    const passiveParts: string[] = [];
    if (hud.cache) passiveParts.push(`>> chain ${hud.cache.stacks}/${hud.cache.max}`);
    if (hud.gc) passiveParts.push(`{} ${hud.gc.charge}/${hud.gc.need}`);
    if (hud.shield) passiveParts.push('T shield');
    if (hud.shieldCharge > 0) passiveParts.push(`() ${hud.shieldCharge}/100`);
    const passive = passiveParts.join('   ');
    if (passive !== this.cachedPassive) {
      this.cachedPassive = passive;
      this.passiveText.setText(passive);
    }
    this.passiveText.setVisible(passive.length > 0);

    if (hud.theme && !hud.boss && !this.overVisible) {
      const theme = `▶ ${hud.theme.label} · ${hud.theme.name} · ${Math.ceil(hud.theme.timeLeft)}s`;
      if (theme !== this.cachedTheme) {
        this.cachedTheme = theme;
        this.themeText.setText(theme);
        this.themeText.setColor(hex(hud.theme.color));
      }
      this.themeText.setVisible(true);
    } else {
      this.themeText.setVisible(false);
      this.cachedTheme = '';
    }

    if (hud.focus && !this.overVisible) {
      const focus = `◎ ${hud.focus.name} · chain ${hud.focus.stacks}/${hud.focus.max} · ${hud.focus.timeLeft.toFixed(1)}s`;
      if (focus !== this.cachedFocus) {
        this.cachedFocus = focus;
        this.focusText.setText(focus);
        this.focusText.setColor(hex(hud.focus.color));
      }
      this.focusText.setVisible(true);
    } else {
      this.focusText.setVisible(false);
      this.cachedFocus = '';
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
      this.bossName.setText(
        `${hud.boss.name}  ·  PHASE ${hud.boss.phase}${hud.boss.weak ? '  ·  WEAK POINT' : ''}`,
      );
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

  private objectiveActiveLabel(event: NonNullable<typeof hud.events>[number]): string {
    if (event.kind === 'compile') return `编译中 · ${event.detail}`;
    if (event.kind === 'commit') return `提交进度 · ${event.detail}`;
    return event.detail;
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
    this.overPanel.setScale(Math.min(1, (w - 24) / 920));
    this.pausePanel.setPosition(w / 2, h / 2);
    this.confirmPanel.setPosition(w / 2, h / 2);
    this.bannerText.setPosition(w / 2, h * 0.2);
    this.bannerSub.setPosition(w / 2, h * 0.2 + 30);

    const bossY = h - 74;
    this.bossBarBg.setPosition(w / 2, bossY);
    this.bossBarFill.setPosition(w / 2 - 229, bossY);
    this.bossName.setPosition(w / 2, bossY - 10);

    const objectiveScale = Math.min(1, Math.max(0.6, (w - 32) / 560));
    this.objectivePanel.setScale(objectiveScale);
    this.objectivePanel.setPosition(w / 2, h - 118);
    this.vignetteAlpha = -1;
  }
}
