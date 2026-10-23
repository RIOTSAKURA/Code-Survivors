import Phaser from 'phaser';
import { DEPTH, PALETTE, PLAYER, SPAWN, TEX_SCALE, WORLD } from '../config';
import { SpatialGrid, findNearestMany } from '../core/grid';
import { applyTextResolution, setupWorldCamera, viewHeight, viewWidth } from '../core/hidpi';
import { ImagePool } from '../core/pool';
import { Rng, rng as globalRng } from '../core/rng';
import { EV, bus, createRun, hud, syncHud } from '../core/state';
import type {
  Beam,
  Clone,
  Enemy,
  EnemyTypeId,
  Orb,
  Orbiter,
  Projectile,
  RunState,
  UpgradeId,
  WeaponId,
} from '../core/types';
import { ENEMY_DEFS, enemyHpScale, enemySpeedScale, pickEnemyType } from '../data/enemies';
import {
  WEAPON_DEFS,
  WEAPON_IDS,
  bombBlast,
  bombCount,
  bombDamage,
  cloneCooldown,
  cloneCount,
  cloneDamage,
  coneAngle,
  coneDamage,
  coneRange,
  dartCount,
  dartDamage,
  dartPierce,
  dartSpeed,
  orbitCount,
  orbitDamage,
  orbitRadius,
  orbitSlotAngles,
  orbitSpin,
  rayCount,
  rayDamage,
  rayWidth,
} from '../data/weapons';
import { PASSIVE_DEFS, PASSIVE_IDS } from '../data/passives';
import { Fx } from '../systems/fx';
import { applyUpgrade, pickChoices, toCard, xpForLevel } from '../systems/progression';

const MAX_ORBIT_SLOTS = 10;
const TAU = Math.PI * 2;

export class GameScene extends Phaser.Scene {
  private run!: RunState;
  private rng!: Rng;
  private grid!: SpatialGrid<Enemy>;
  private fx!: Fx;
  private images!: ImagePool;

  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private orbs: Orb[] = [];
  private orbiters: Orbiter[] = [];
  private clones: Clone[] = [];
  private beams: Beam[] = [];

  private playerSprite!: Phaser.GameObjects.Image;
  private playerX = 0;
  private playerY = 0;
  private facing = 0;
  private invulnUntil = 0;
  private knockVx = 0;
  private knockVy = 0;

  private gridSprite!: Phaser.GameObjects.TileSprite;
  private beamGraphics!: Phaser.GameObjects.Graphics;
  private rangeGraphics!: Phaser.GameObjects.Graphics;
  private lastRange = -1;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private weaponTimers = new Map<WeaponId, number>();
  private spawnTimer = 0;
  private nextBossAt = SPAWN.bossFirstAt;
  private bossGeneration = 0;
  private enemyId = 1;
  private xpNeed = xpForLevel(1);
  private choosing = false;
  private paused = false;
  private chooseTimer = 0;
  private pendingChoices: UpgradeId[] = [];
  private lastPauseToggle = -1000;
  private panelOpen = false;
  private orbitPhase = 0;
  private orbiterSeq = 0;
  private scratch: Enemy[] = [];
  private scratch2: Enemy[] = [];
  private targetScratch: Enemy[] = [];

  constructor() {
    super('Game');
  }

  create(): void {
    this.run = createRun();
    this.rng = new Rng(Math.floor(globalRng.next() * 0xffffffff));
    this.grid = new SpatialGrid<Enemy>(110);
    this.enemies = [];
    this.projectiles = [];
    this.orbs = [];
    this.orbiters = [];
    this.clones = [];
    this.beams = [];
    this.weaponTimers.clear();
    this.spawnTimer = 1.2;
    this.nextBossAt = SPAWN.bossFirstAt;
    this.bossGeneration = 0;
    this.enemyId = 1;
    this.xpNeed = xpForLevel(1);
    this.choosing = false;
    this.paused = false;
    this.pendingChoices = [];
    this.lastPauseToggle = -1000;
    this.panelOpen = false;
    this.orbitPhase = 0;
    this.orbiterSeq = 0;
    this.invulnUntil = 0;
    this.knockVx = 0;
    this.knockVy = 0;
    this.lastRange = -1;
    hud.boss = null;
    hud.choices = 0;
    hud.damageFlash = 0;
    hud.gameOver = false;
    hud.paused = false;
    hud.version++;

    this.playerX = WORLD.width / 2;
    this.playerY = WORLD.height / 2;
    this.facing = -Math.PI / 2;
    this.run.pendingLevels = 1;
    this.applyQaSkip();
    this.refreshHudLists();

    this.images = new ImagePool(this, 640, DEPTH.projectile, Phaser.BlendModes.ADD);
    this.fx = new Fx(this);

    const mainCam = this.cameras.main;
    this.gridSprite = this.add
      .tileSprite(0, 0, viewWidth(mainCam), viewHeight(mainCam), 'grid')
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DEPTH.ground);
    this.gridSprite.setTileScale(TEX_SCALE, TEX_SCALE);

    this.add
      .rectangle(WORLD.width / 2, WORLD.height / 2, WORLD.width, WORLD.height)
      .setStrokeStyle(6, 0x89b4fa, 0.25)
      .setDepth(DEPTH.ground);

    this.rangeGraphics = this.add.graphics().setDepth(DEPTH.ground + 1);
    this.beamGraphics = this.add.graphics().setDepth(DEPTH.beam).setBlendMode(Phaser.BlendModes.ADD);

    this.playerSprite = this.add.image(this.playerX, this.playerY, 'player').setDepth(DEPTH.player);
    this.playerSprite.setBlendMode(Phaser.BlendModes.ADD);
    this.playerSprite.setTint(PALETTE.cyan);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD.width, WORLD.height);
    cam.startFollow(this.playerSprite, true, 0.12, 0.12);
    cam.setBackgroundColor(PALETTE.bgDeep);
    setupWorldCamera(cam);

    const keyboard = this.input.keyboard!;
    this.keys = keyboard.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    const onPauseKey = () => {
      if (!this.run.over && !this.choosing) this.togglePause();
    };
    keyboard.on('keydown-P', onPauseKey);
    keyboard.on('keydown-ESC', onPauseKey);
    keyboard.on('keydown-M', () => bus.emit(EV.sfxToggle, undefined));

    const onChoice = (payload: { index: number }) => this.applyChoice(payload.index);
    const onRestart = () => this.scene.restart();
    const onResize = () => {
      this.gridSprite.setSize(viewWidth(cam), viewHeight(cam));
    };
    bus.on(EV.choicePicked, onChoice);
    bus.on(EV.restart, onRestart);
    this.scale.on('resize', onResize);

    this.events.once('shutdown', () => {
      bus.off(EV.choicePicked, onChoice);
      bus.off(EV.restart, onRestart);
      this.scale.off('resize', onResize);
      this.fx.clear();
      hud.boss = null;
    });

    applyTextResolution(this);
    this.time.delayedCall(120, () => {
      bus.emit(EV.banner, { text: 'npm run survive', sub: 'ENTER THE STACK', ms: 1800 });
    });
    this.fx.burst(this.playerX, this.playerY, PALETTE.cyan, 24, 220, 0.9, 0.9);
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 1 / 30);

    if (this.run.over) {
      this.fx.update(dt);
      this.updateBeams(dt);
      this.drawBeams();
      return;
    }

    if (this.choosing) {
      this.fx.update(dt);
      syncHud(this.run, this.xpNeed);
      if (this.panelOpen) return;
      if (this.chooseTimer > 0) {
        this.chooseTimer -= dt;
        return;
      }
      if (this.run.pendingLevels > 0) {
        this.openUpgrades();
      } else {
        this.choosing = false;
      }
      return;
    }

    if (this.paused) {
      this.fx.update(dt * 0.25);
      return;
    }

    this.run.time += dt;
    this.grid.rebuild(this.enemies);

    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateWeapons(dt);
    this.updateProjectiles(dt);
    this.updateOrbs(dt);
    this.updateSpawner(dt);
    this.updateBeams(dt);

    this.fx.update(dt);
    this.pruneEntities();
    hud.orbs = this.orbs.length;
    this.drawBeams();
    this.updateCamera();
    this.checkLevelUp();
    syncHud(this.run, this.xpNeed);
  }

  private applyQaSkip(): void {
    if (typeof window === 'undefined') return;
    const skip = Number(new URLSearchParams(window.location.search).get('skip') ?? '0');
    if (!Number.isFinite(skip) || skip <= 0) return;
    this.run.time = skip;
    this.nextBossAt = skip + 4;
    this.spawnTimer = 0;
    const levels = Math.min(45, 1 + Math.floor(0.05 * Math.pow(skip, 1.25)));
    this.run.level = levels;
    this.xpNeed = xpForLevel(this.run.level);
    for (let i = 0; i < Math.min(WEAPON_IDS.length, 2 + Math.floor(levels / 3)); i++) {
      applyUpgrade(this.run, WEAPON_IDS[i]);
      applyUpgrade(this.run, WEAPON_IDS[i]);
    }
    for (let i = 0; i < Math.min(PASSIVE_IDS.length, 1 + Math.floor(levels / 4)); i++) {
      applyUpgrade(this.run, PASSIVE_IDS[i]);
    }
    this.run.hp = this.run.stats.maxHp;
  }

  private togglePause(): void {
    const now = this.time.now;
    if (now - this.lastPauseToggle < 250) return;
    this.lastPauseToggle = now;
    this.paused = !this.paused;
    hud.paused = this.paused;
    bus.emit(EV.banner, { text: this.paused ? 'paused' : 'resumed', sub: '', ms: 700 });
  }

  private updateCamera(): void {
    this.gridSprite.tilePositionX = this.cameras.main.scrollX;
    this.gridSprite.tilePositionY = this.cameras.main.scrollY;
    const range = this.run.stats.pickupRadius;
    if (range !== this.lastRange) {
      this.lastRange = range;
      this.rangeGraphics.clear();
      this.rangeGraphics.lineStyle(1.5, PALETTE.green, 0.16);
      this.rangeGraphics.strokeCircle(0, 0, range);
      this.rangeGraphics.setPosition(this.playerX, this.playerY);
    }
  }

  private updatePlayer(dt: number): void {
    const stats = this.run.stats;
    let dx = 0;
    let dy = 0;
    if (this.keys.A.isDown || this.keys.LEFT.isDown) dx -= 1;
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) dx += 1;
    if (this.keys.W.isDown || this.keys.UP.isDown) dy -= 1;
    if (this.keys.S.isDown || this.keys.DOWN.isDown) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      this.facing = Math.atan2(dy, dx);
      this.playerX += dx * stats.speed * dt;
      this.playerY += dy * stats.speed * dt;
    }

    this.knockVx *= Math.pow(0.86, dt * 60);
    this.knockVy *= Math.pow(0.86, dt * 60);
    this.playerX += this.knockVx * dt;
    this.playerY += this.knockVy * dt;

    const pad = 24;
    this.playerX = Phaser.Math.Clamp(this.playerX, pad, WORLD.width - pad);
    this.playerY = Phaser.Math.Clamp(this.playerY, pad, WORLD.height - pad);

    this.playerSprite.setPosition(this.playerX, this.playerY);
    this.playerSprite.setRotation(Math.sin(this.run.time * 2.4) * 0.05);
    this.rangeGraphics.setPosition(this.playerX, this.playerY);
    const hurt = this.invulnUntil > this.run.time;
    this.playerSprite.setAlpha(hurt ? 0.45 + 0.4 * Math.sin(this.run.time * 40) : 1);
    this.playerSprite.setTint(hurt ? PALETTE.red : PALETTE.cyan);
    const scale = 1 + Math.sin(this.run.time * 3.2) * 0.03;
    this.playerSprite.setScale(scale * TEX_SCALE);
  }

  private updateEnemies(dt: number): void {
    const time = this.run.time;
    const px = this.playerX;
    const py = this.playerY;
    const speedScale = enemySpeedScale(time);

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      const def = ENEMY_DEFS[e.type];
      const dx = px - e.x;
      const dy = py - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      let speed = e.speed * speedScale;
      if (e.type === 'memleak') {
        e.growT = Math.min(e.growT + dt, 30);
        const grow = Math.min(1 + e.growT * 0.035, 1.85);
        e.radius = def.radius * grow;
        speed *= 1 / grow;
        if (e.sprite) e.sprite.setScale(grow * (e.elite ? 1.25 : 1) * TEX_SCALE);
      }
      if (e.boss) {
        speed *= 1 + (this.bossPhase(e) - 1) * 0.22;
      }

      e.vx = nx * speed;
      e.vy = ny * speed;

      if (e.type === 'race') {
        e.blinkAt -= dt;
        if (e.sprite) e.sprite.setAlpha(0.55 + 0.45 * Math.abs(Math.sin(time * 6 + e.id)));
        if (e.blinkAt <= 0 && dist > 120) {
          e.blinkAt = this.rng.range(1.5, 2.6);
          const step = Math.min(dist - 60, 170);
          this.fx.burst(e.x, e.y, e.color, 5, 130, 0.35, 0.5);
          e.x += nx * step;
          e.y += ny * step;
          this.fx.burst(e.x, e.y, e.color, 5, 130, 0.35, 0.5);
        }
      }

      if (e.boss) {
        this.updateBoss(e, dt, dist);
        if (hud.boss) {
          hud.boss.hp = e.hp;
          hud.boss.phase = this.bossPhase(e);
        }
      }

      if (e.knockX !== 0 || e.knockY !== 0) {
        e.x += e.knockX * dt;
        e.y += e.knockY * dt;
        const decay = Math.pow(0.82, dt * 60);
        e.knockX *= decay;
        e.knockY *= decay;
        if (Math.abs(e.knockX) < 2) e.knockX = 0;
        if (Math.abs(e.knockY) < 2) e.knockY = 0;
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      if (!def.phasing) this.separate(e, dt);

      if (e.sprite) {
        e.sprite.setPosition(e.x, e.y);
        const flash = time - e.hitAt < 0.09;
        e.sprite.setTint(flash ? PALETTE.white : e.color);
      }

      const touchDist = e.radius + PLAYER.radius;
      if (dist < touchDist) {
        this.touchPlayer(e);
      }
    }
  }

  private separate(e: Enemy, dt: number): void {
    const neighbors = this.grid.query(e.x, e.y, e.radius * 1.8, this.scratch);
    let pushX = 0;
    let pushY = 0;
    for (let i = 0; i < neighbors.length; i++) {
      const o = neighbors[i];
      if (o === e) continue;
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      const minDist = e.radius + o.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > minDist * minDist || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const overlap = (minDist - d) / minDist;
      pushX += (dx / d) * overlap;
      pushY += (dy / d) * overlap;
    }
    const strength = 190;
    e.x += pushX * strength * dt;
    e.y += pushY * strength * dt;
  }

  private touchPlayer(e: Enemy): void {
    if (this.invulnUntil > this.run.time) return;
    const damage = Math.max(1, e.damage - this.run.stats.armor);
    this.hurtPlayer(damage);
    const dx = this.playerX - e.x;
    const dy = this.playerY - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const force = e.type === 'stack' || e.boss ? 260 : 110;
    this.knockVx += (dx / d) * force;
    this.knockVy += (dy / d) * force;
    e.knockX -= (dx / d) * 120;
    e.knockY -= (dy / d) * 120;
  }

  private hurtPlayer(damage: number): void {
    if (this.run.over) return;
    this.run.hp -= damage;
    this.invulnUntil = this.run.time + PLAYER.invulnTime;
    hud.damageFlash = 1;
    this.cameras.main.shake(160, 0.006);
    this.fx.text(this.playerX, this.playerY - 34, 'ERROR', '#ff0040', 16);
    this.fx.burst(this.playerX, this.playerY, PALETTE.red, 10, 180, 0.5, 0.7);
    if (this.run.hp <= 0) {
      this.run.hp = 0;
      this.endRun();
    } else {
      bus.emit(EV.banner, { text: `-${Math.round(damage)} HP`, sub: 'segmentation fault avoided', ms: 620 });
    }
  }

  private endRun(): void {
    this.run.over = true;
    hud.gameOver = true;
    syncHud(this.run, this.xpNeed);
    this.fx.burst(this.playerX, this.playerY, PALETTE.cyan, 46, 340, 1.2, 1.1);
    this.fx.burst(this.playerX, this.playerY, PALETTE.red, 26, 240, 1.4, 1.2);
    this.cameras.main.shake(420, 0.013);
    bus.emit(EV.gameOver, {
      time: this.run.time,
      kills: this.run.kills,
      level: this.run.level,
      weapons: Object.keys(this.run.weapons).length,
    });
  }

  private bossPhase(e: Enemy): number {
    const ratio = e.hp / e.maxHp;
    if (ratio > 0.66) return 1;
    if (ratio > 0.33) return 2;
    return 3;
  }

  private updateBoss(e: Enemy, dt: number, dist: number): void {
    const phase = this.bossPhase(e);
    e.castAt -= dt;
    e.summonAt -= dt;
    if (e.castAt <= 0 && dist < 900) {
      e.castAt = phase === 3 ? 2.2 : phase === 2 ? 2.8 : 3.4;
      const count = phase === 3 ? 18 : phase === 2 ? 14 : 10;
      const offset = this.rng.range(0, TAU);
      for (let i = 0; i < count; i++) {
        const angle = offset + (i / count) * TAU;
        this.spawnProjectile({
          x: e.x,
          y: e.y,
          vx: Math.cos(angle) * 190,
          vy: Math.sin(angle) * 190,
          damage: 8 + phase * 2,
          radius: 11,
          life: 6,
          pierce: 0,
          hostile: true,
          color: PALETTE.red,
          texture: 'proj_bullet',
          fuse: 0,
          blast: 0,
        });
      }
      this.fx.burst(e.x, e.y, PALETTE.red, 14, 240, 0.5, 0.9);
      bus.emit(EV.banner, { text: `0xDEAD · PHASE ${phase}`, sub: phase === 1 ? 'thread spawned' : 'core dumping', ms: 900 });
    }
    if (phase >= 2 && e.summonAt <= 0) {
      e.summonAt = phase === 3 ? 6.5 : 8.5;
      const n = phase === 3 ? 8 : 5;
      for (let i = 0; i < n; i++) {
        const angle = this.rng.range(0, TAU);
        const r = this.rng.range(50, 140);
        this.spawnEnemy('syntax', e.x + Math.cos(angle) * r, e.y + Math.sin(angle) * r, true);
      }
      this.fx.burst(e.x, e.y, PALETTE.orange, 16, 260, 0.6, 0.9);
    }
  }

  private updateWeapons(dt: number): void {
    const stats = this.run.stats;
    for (const id of WEAPON_IDS) {
      const level = this.run.weapons[id] ?? 0;
      if (level <= 0) continue;
      if (id === 'orbit') {
        this.syncOrbiters(level, dt);
        continue;
      }
      if (id === 'clone') {
        this.syncClones(level, dt);
        continue;
      }
      const def = WEAPON_DEFS[id];
      const timer = (this.weaponTimers.get(id) ?? 0) - dt;
      if (timer > 0) {
        this.weaponTimers.set(id, timer);
        continue;
      }
      this.weaponTimers.set(id, def.cooldown(level) * stats.cooldownMult);
      this.fireWeapon(id, level);
    }
  }

  private pickTargetsAround(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = range * range;
    const list = this.grid.query(x, y, range, this.scratch2);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d = dx * dx + dy * dy;
      const bias = e.boss ? 0.25 : 1;
      if (d * bias < bestDist) {
        bestDist = d * bias;
        best = e;
      }
    }
    return best;
  }

  private pickTargets(count: number, range: number): Enemy[] {
    const targets = findNearestMany(this.grid, this.playerX, this.playerY, range, count + 1, this.targetScratch);
    const boss = targets.find((e) => e.boss && !e.dead);
    if (boss) {
      const rest = targets.filter((e) => e !== boss);
      return [boss, ...rest].slice(0, Math.max(1, count));
    }
    return targets;
  }

  private fireWeapon(id: WeaponId, level: number): void {
    const stats = this.run.stats;
    const bonus = stats.projectileBonus;

    if (id === 'dart') {
      const count = dartCount(level) + bonus;
      const targets = this.pickTargets(count, SPAWN.engageRange);
      for (let i = 0; i < count; i++) {
        const target = targets[i % Math.max(1, targets.length)];
        const angle = target
          ? Math.atan2(target.y - this.playerY, target.x - this.playerX)
          : this.facing + (i - (count - 1) / 2) * 0.16;
        const jitter = targets.length > 1 && i < targets.length ? 0 : this.rng.range(-0.05, 0.05);
        const speed = dartSpeed(level);
        this.spawnProjectile({
          x: this.playerX,
          y: this.playerY,
          vx: Math.cos(angle + jitter) * speed,
          vy: Math.sin(angle + jitter) * speed,
          damage: dartDamage(level) * stats.damageMult,
          radius: 9,
          life: 1.2,
          pierce: dartPierce(level),
          hostile: false,
          color: PALETTE.cyan,
          texture: 'w_dart',
          fuse: 0,
          blast: 0,
        });
      }
      bus.emit('sfx', 'shoot');
      return;
    }

    if (id === 'bomb') {
      const count = bombCount(level) + bonus;
      const targets = this.pickTargets(count, SPAWN.engageRange);
      for (let i = 0; i < count; i++) {
        const target = targets[i % Math.max(1, targets.length)];
        const angle = target
          ? Math.atan2(target.y - this.playerY, target.x - this.playerX)
          : this.facing + this.rng.range(-0.4, 0.4);
        const dist = target ? Math.hypot(target.x - this.playerX, target.y - this.playerY) : 240;
        const travel = Phaser.Math.Clamp(dist, 70, SPAWN.engageRange);
        const fuse = travel / 420;
        this.spawnProjectile({
          x: this.playerX,
          y: this.playerY,
          vx: Math.cos(angle) * 420,
          vy: Math.sin(angle) * 420,
          damage: bombDamage(level) * stats.damageMult,
          radius: 13,
          life: fuse,
          pierce: 0,
          hostile: false,
          color: PALETTE.orange,
          texture: 'w_bomb',
          fuse,
          blast: bombBlast(level),
        });
      }
      bus.emit('sfx', 'shoot');
      return;
    }

    if (id === 'ray') {
      const count = rayCount(level) + bonus;
      const targets = this.pickTargets(count, SPAWN.engageRange);
      const width = rayWidth(level);
      const length = SPAWN.beamRange;
      for (let i = 0; i < count; i++) {
        const target = targets[i % Math.max(1, targets.length)];
        const angle = target
          ? Math.atan2(target.y - this.playerY, target.x - this.playerX)
          : this.facing + (i - (count - 1) / 2) * 0.3;
        this.beams.push({
          kind: 'ray',
          x: this.playerX,
          y: this.playerY,
          angle,
          length,
          width,
          spread: 0,
          color: PALETTE.green,
          life: 0.16,
          maxLife: 0.16,
        });
        this.damageAlongRay(angle, length, width, rayDamage(level) * stats.damageMult);
      }
      bus.emit('sfx', 'shoot');
      return;
    }

    if (id === 'cone') {
      const target = this.pickTargets(1, SPAWN.engageRange)[0] ?? null;
      const angle = target
        ? Math.atan2(target.y - this.playerY, target.x - this.playerX)
        : this.facing;
      const spread = Phaser.Math.DegToRad(coneAngle(level));
      const range = coneRange(level);
      this.beams.push({
        kind: 'cone',
        x: this.playerX,
        y: this.playerY,
        angle,
        length: range,
        width: 0,
        spread,
        color: 0x9aa5c4,
        life: 0.2,
        maxLife: 0.2,
      });
      this.damageInCone(angle, range, spread, coneDamage(level) * stats.damageMult);
      bus.emit('sfx', 'shoot');
    }
  }

  private damageAlongRay(angle: number, length: number, width: number, damage: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hitSet = new Set<number>();
    const step = 36;
    for (let d = 0; d <= length; d += step) {
      const x = this.playerX + cos * d;
      const y = this.playerY + sin * d;
      const list = this.grid.query(x, y, width * 0.5 + 26, this.scratch2);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.dead || hitSet.has(e.id)) continue;
        const perp = Math.abs((e.x - this.playerX) * sin - (e.y - this.playerY) * cos);
        if (perp > width * 0.5 + e.radius) continue;
        hitSet.add(e.id);
        this.damageEnemy(e, damage, true, cos * 90, sin * 90);
      }
    }
  }

  private damageInCone(angle: number, range: number, spread: number, damage: number): void {
    const list = this.grid.query(this.playerX, this.playerY, range, this.scratch2);
    const half = spread / 2;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.x - this.playerX;
      const dy = e.y - this.playerY;
      const dist = Math.hypot(dx, dy);
      if (dist > range + e.radius) continue;
      let diff = Math.atan2(dy, dx) - angle;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      if (Math.abs(diff) > half) continue;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      this.damageEnemy(e, damage, true, cos * 120, sin * 120);
    }
  }

  private syncOrbiters(level: number, dt: number): void {
    const count = orbitCount(level);
    while (this.orbiters.length > count) {
      const o = this.orbiters.pop()!;
      if (o.sprite) this.images.release(o.sprite);
    }
    this.orbitPhase = (this.orbitPhase + orbitSpin(level) * dt) % TAU;
    const slots = orbitSlotAngles(count, this.orbitPhase);
    while (this.orbiters.length < count) {
      const slot = this.orbiters.length;
      const sprite = this.images.acquire();
      sprite.setTexture('w_orbit');
      sprite.setDepth(DEPTH.orbiter);
      this.orbiters.push({
        index: this.orbiterSeq++ % MAX_ORBIT_SLOTS,
        angle: slots[slot],
        radius: orbitRadius(level),
        damage: orbitDamage(level),
        x: this.playerX,
        y: this.playerY,
        sprite,
      });
    }
    const radius = orbitRadius(level);
    const damage = orbitDamage(level) * this.run.stats.damageMult;
    for (let i = 0; i < this.orbiters.length; i++) {
      const o = this.orbiters[i];
      o.radius = radius;
      o.damage = damage;
      let drift = slots[i] - o.angle;
      while (drift > Math.PI) drift -= TAU;
      while (drift < -Math.PI) drift += TAU;
      o.angle += drift * Math.min(1, dt * 8);
      o.x = this.playerX + Math.cos(o.angle) * radius;
      o.y = this.playerY + Math.sin(o.angle) * radius;
      if (o.sprite) {
        o.sprite.setPosition(o.x, o.y);
        o.sprite.setRotation(o.angle);
      }
      const list = this.grid.query(o.x, o.y, 26, this.scratch2);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.dead) continue;
        const dx = e.x - o.x;
        const dy = e.y - o.y;
        if (dx * dx + dy * dy > (e.radius + 13) ** 2) continue;
        const last = e.orbitHit[o.index] ?? 0;
        if (this.run.time - last < 0.32) continue;
        e.orbitHit[o.index] = this.run.time;
        const d = Math.hypot(dx, dy) || 1;
        this.damageEnemy(e, o.damage, false, (dx / d) * 130, (dy / d) * 130);
      }
    }
  }

  private syncClones(level: number, dt: number): void {
    const want = cloneCount(level);
    while (this.clones.length > want) {
      const c = this.clones.pop()!;
      if (c.sprite) this.images.release(c.sprite);
    }
    while (this.clones.length < want) {
      const index = this.clones.length;
      const sprite = this.images.acquire();
      sprite.setTexture('w_clone');
      sprite.setDepth(DEPTH.clone);
      sprite.setTint(PALETTE.purple);
      this.clones.push({
        angle: (index / want) * TAU + Math.PI,
        distance: 76,
        x: this.playerX,
        y: this.playerY,
        fireAt: 0.4,
        damage: cloneDamage(level),
        sprite,
      });
    }
    const damage = cloneDamage(level) * this.run.stats.damageMult;
    for (let i = 0; i < this.clones.length; i++) {
      const c = this.clones[i];
      c.damage = damage;
      c.angle += 0.9 * dt;
      c.x = this.playerX + Math.cos(c.angle) * c.distance;
      c.y = this.playerY + Math.sin(c.angle) * c.distance;
      if (c.sprite) {
        c.sprite.setPosition(c.x, c.y);
        c.sprite.setAlpha(0.55 + 0.45 * Math.sin(this.run.time * 6 + i));
      }
      c.fireAt -= dt;
      if (c.fireAt <= 0) {
        c.fireAt = cloneCooldown(level) * this.run.stats.cooldownMult;
        const target = this.pickTargetsAround(c.x, c.y, SPAWN.engageRange);
        if (!target) continue;
        const angle = Math.atan2(target.y - c.y, target.x - c.x);
        const speed = dartSpeed(level);
        this.spawnProjectile({
          x: c.x,
          y: c.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          damage: c.damage,
          radius: 8,
          life: 1.8,
          pierce: 0,
          hostile: false,
          color: PALETTE.purple,
          texture: 'w_dart',
          fuse: 0,
          blast: 0,
        });
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const stats = this.run.stats;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (p.dead) continue;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.blast > 0) this.explode(p);
        p.dead = true;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.trailAt -= dt;
      if (p.sprite) {
        p.sprite.setPosition(p.x, p.y);
        p.sprite.setRotation(Math.atan2(p.vy, p.vx));
      }
      if (p.trailAt <= 0) {
        p.trailAt = 0.035;
        this.fx.trail(p.x, p.y, p.color, p.hostile ? 0.5 : 0.45);
      }

      if (p.fuse > 0) continue;

      if (p.hostile) {
        const dx = this.playerX - p.x;
        const dy = this.playerY - p.y;
        if (dx * dx + dy * dy < (p.radius + PLAYER.radius) ** 2) {
          p.dead = true;
          this.hurtPlayer(Math.max(1, p.damage - stats.armor));
          this.fx.burst(p.x, p.y, p.color, 8, 160, 0.4, 0.6);
        }
        continue;
      }

      const list = this.grid.query(p.x, p.y, p.radius + 30, this.scratch);
      for (let k = 0; k < list.length; k++) {
        const e = list[k];
        if (e.dead || p.hit.has(e.id)) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        if (dx * dx + dy * dy > (e.radius + p.radius) ** 2) continue;
        p.hit.add(e.id);
        const len = Math.hypot(p.vx, p.vy) || 1;
        this.damageEnemy(e, p.damage, p.blast > 0, (p.vx / len) * 110, (p.vy / len) * 110);
        if (p.blast > 0) {
          this.explode(p);
          p.dead = true;
          break;
        }
        if (stats.splitChance > 0 && !p.split && this.rng.chance(stats.splitChance)) {
          this.splitProjectile(p);
        }
        if (p.pierce > 0) {
          p.pierce -= 1;
        } else {
          this.fx.burst(p.x, p.y, p.color, 5, 130, 0.3, 0.5);
          p.dead = true;
          break;
        }
      }

      if (p.x < 0 || p.y < 0 || p.x > WORLD.width || p.y > WORLD.height) p.dead = true;
    }
  }

  private splitProjectile(p: Projectile): void {
    p.split = true;
    const speed = Math.hypot(p.vx, p.vy);
    const base = Math.atan2(p.vy, p.vx);
    for (const offset of [-0.42, 0.42]) {
      this.spawnProjectile({
        x: p.x,
        y: p.y,
        vx: Math.cos(base + offset) * speed,
        vy: Math.sin(base + offset) * speed,
        damage: p.damage * 0.55,
        radius: p.radius * 0.85,
        life: 1.2,
        pierce: 0,
        hostile: false,
        color: PALETTE.white,
        texture: 'w_dart',
        fuse: 0,
        blast: 0,
      });
    }
    this.fx.text(p.x, p.y - 12, '|⟩', '#ffffff', 12);
  }

  private explode(p: Projectile): void {
    const list = this.grid.query(p.x, p.y, p.blast, this.scratch2);
    let hits = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > p.blast + e.radius) continue;
      const falloff = Phaser.Math.Clamp(1 - dist / (p.blast + e.radius), 0.45, 1);
      this.damageEnemy(e, p.damage * falloff, false, (dx / (dist || 1)) * 200, (dy / (dist || 1)) * 200);
      hits++;
    }
    this.fx.burst(p.x, p.y, PALETTE.orange, 18, 300, 0.55, 0.9);
    this.beams.push({
      kind: 'cone',
      x: p.x,
      y: p.y,
      angle: 0,
      length: p.blast,
      width: 0,
      spread: TAU,
      color: PALETTE.orange,
      life: 0.22,
      maxLife: 0.22,
    });
    if (hits > 0) bus.emit('sfx', 'explode');
  }

  private spawnProjectile(config: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    radius: number;
    life: number;
    pierce: number;
    hostile: boolean;
    color: number;
    texture: string;
    fuse: number;
    blast: number;
  }): void {
    const sprite = this.images.acquire();
    sprite.setTexture(config.texture);
    sprite.setTint(config.color);
    sprite.setDepth(DEPTH.projectile);
    sprite.setPosition(config.x, config.y);
    this.projectiles.push({
      x: config.x,
      y: config.y,
      vx: config.vx,
      vy: config.vy,
      damage: config.damage,
      radius: config.radius,
      life: config.life,
      pierce: config.pierce,
      hostile: config.hostile,
      color: config.color,
      sprite,
      hit: new Set<number>(),
      split: false,
      trailAt: 0,
      fuse: config.fuse,
      blast: config.blast,
      dead: false,
    });
  }

  private updateOrbs(dt: number): void {
    const stats = this.run.stats;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (o.dead) continue;
      const dx = this.playerX - o.x;
      const dy = this.playerY - o.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < stats.pickupRadius) {
        const speed = Math.max(stats.speed * PLAYER.magnetCatchUp, dist * PLAYER.magnetGain);
        const blend = Math.min(1, dt * 18);
        o.vx += ((dx / dist) * speed - o.vx) * blend;
        o.vy += ((dy / dist) * speed - o.vy) * blend;
      } else {
        const decay = Math.pow(0.86, dt * 60);
        o.vx *= decay;
        o.vy *= decay;
        if (Math.abs(o.vx) < 2) o.vx = 0;
        if (Math.abs(o.vy) < 2) o.vy = 0;
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.sprite) {
        o.sprite.setPosition(o.x, o.y);
        const pulse = 1 + 0.12 * Math.sin(this.run.time * 6 + o.value);
        o.sprite.setScale(pulse * (o.big ? 1.35 : 1) * TEX_SCALE);
      }
      const restX = this.playerX - o.x;
      const restY = this.playerY - o.y;
      if (restX * restX + restY * restY <= PLAYER.collectRadius * PLAYER.collectRadius) {
        o.dead = true;
        this.run.xp += o.value;
        bus.emit('sfx', 'pickup');
        this.fx.burst(o.x, o.y, PALETTE.green, o.big ? 8 : 3, 110, 0.3, 0.45);
      }
    }
  }

  private dropOrbs(x: number, y: number, value: number, big: boolean): void {
    const count = big ? 6 : this.rng.int(1, 3);
    const per = Math.max(0.5, (value * SPAWN.xpValueScale) / count);
    for (let i = 0; i < count; i++) {
      const isBig = big || this.rng.chance(0.09);
      const angle = this.rng.range(0, TAU);
      const speed = this.rng.range(40, 115);
      const sprite = this.images.acquire();
      sprite.setTexture(this.rng.chance(0.5) ? 'orb_0' : 'orb_1');
      sprite.setTint(isBig ? PALETTE.cyan : PALETTE.green);
      sprite.setDepth(DEPTH.orb);
      sprite.setScale(isBig ? 1.35 * TEX_SCALE : TEX_SCALE);
      sprite.setPosition(x, y);
      this.orbs.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        value: isBig ? per * 3 : per,
        big: isBig,
        sprite,
        dead: false,
      });
    }
  }

  private damageEnemy(e: Enemy, amount: number, showText: boolean, knockX = 0, knockY = 0): void {
    if (e.dead) return;
    const crit = this.rng.chance(0.1);
    const dmg = amount * (crit ? 2 : 1);
    e.hp -= dmg;
    e.hitAt = this.run.time;
    if (knockX !== 0 || knockY !== 0) {
      const resist = e.boss ? 0.06 : e.type === 'stack' ? 0.25 : 1;
      e.knockX += knockX * resist;
      e.knockY += knockY * resist;
    }
    if (e.hp <= 0) {
      this.killEnemy(e);
      return;
    }
    if (showText || crit) this.fx.damageText(e.x, e.y - e.radius - 6, dmg, crit);
    this.fx.sparks(e.x, e.y, e.color, crit ? 4 : 2);
  }

  private killEnemy(e: Enemy): void {
    if (e.dead) return;
    e.dead = true;
    this.run.kills += 1;
    const def = ENEMY_DEFS[e.type];
    this.fx.burst(e.x, e.y, e.color, e.boss ? 44 : e.elite ? 14 : 8, e.boss ? 380 : 200, 0.6, e.boss ? 1.3 : 0.75);
    this.dropOrbs(e.x, e.y, e.xp, e.boss);
    bus.emit('sfx', e.boss ? 'explode' : 'hit');
    if (e.boss) {
      hud.boss = null;
      this.cameras.main.shake(500, 0.012);
      bus.emit(EV.banner, { text: 'CORE DUMPED', sub: `${def.name} terminated`, ms: 1600 });
    }
  }

  private updateSpawner(dt: number): void {
    const time = this.run.time;
    if (time >= this.nextBossAt) {
      this.nextBossAt += SPAWN.bossEvery;
      this.spawnBoss();
    }
    if (this.enemies.length >= SPAWN.maxEnemies) {
      this.spawnTimer = 0;
      return;
    }
    const rate = Math.min(SPAWN.rateMax, SPAWN.rateBase + time * SPAWN.rateGrowth);
    this.spawnTimer += rate * dt;
    let budget = SPAWN.maxPerFrame;
    while (this.spawnTimer >= 1 && budget > 0) {
      this.spawnTimer -= 1;
      budget -= 1;
      this.spawnEnemy();
    }
    if (this.spawnTimer > SPAWN.maxPerFrame) this.spawnTimer = 0;
  }

  private spawnEnemy(type?: EnemyTypeId, x?: number, y?: number, forceNormal = false): Enemy | null {
    const time = this.run.time;
    const id = type ?? pickEnemyType(time, this.rng.next());
    const def = ENEMY_DEFS[id];
    const pos = x === undefined || y === undefined ? this.ringPosition() : { x, y };
    if (!pos) return null;
    const eliteChance = Math.min(0.16, time / 1100);
    const elite = !forceNormal && !type && this.rng.chance(eliteChance);
    const hpScale = enemyHpScale(time, this.run.level);
    const hp = def.hp * hpScale * (elite ? 3.4 : 1);
    const sprite = this.images.acquire();
    sprite.setTexture(`e_${id}`);
    sprite.setTint(def.color);
    sprite.setDepth(DEPTH.enemy);
    const enemy: Enemy = {
      id: this.enemyId++,
      type: id,
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      radius: def.radius * (elite ? 1.25 : 1),
      speed: def.speed * (elite ? 0.9 : 1),
      damage: def.damage * (elite ? 1.35 : 1) * (1 + time / 1200),
      xp: Math.round(def.xp * (elite ? 3 : 1)),
      color: def.color,
      glyph: def.glyph,
      boss: false,
      elite,
      phasing: def.phasing,
      dead: false,
      sprite,
      hitAt: -10,
      touchAt: 0,
      blinkAt: this.rng.range(0.6, 1.8),
      castAt: 3,
      summonAt: 6,
      growT: 0,
      orbitHit: new Array<number>(MAX_ORBIT_SLOTS).fill(-10),
      knockX: this.rng.range(-10, 10),
      knockY: this.rng.range(-10, 10),
    };
    if (elite) {
      sprite.setScale(1.25 * TEX_SCALE);
      sprite.setAlpha(0.95);
    }
    sprite.setPosition(enemy.x, enemy.y);
    this.enemies.push(enemy);
    return enemy;
  }

  private spawnBoss(): void {
    const time = this.run.time;
    const def = ENEMY_DEFS.boss;
    const pos = this.ringPosition();
    if (!pos) return;
    this.bossGeneration += 1;
    const scale = (1 + (this.bossGeneration - 1) * 0.65) * (1 + time / 600);
    const hp = def.hp * scale;
    const sprite = this.images.acquire();
    sprite.setTexture('e_boss');
    sprite.setTint(def.color);
    sprite.setDepth(DEPTH.boss);
    sprite.setPosition(pos.x, pos.y);
    const boss: Enemy = {
      id: this.enemyId++,
      type: 'boss',
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      radius: def.radius,
      speed: def.speed,
      damage: def.damage,
      xp: def.xp,
      color: def.color,
      glyph: def.glyph,
      boss: true,
      elite: false,
      phasing: false,
      dead: false,
      sprite,
      hitAt: -10,
      touchAt: 0,
      blinkAt: 0,
      castAt: 3.4,
      summonAt: 8.5,
      growT: 0,
      orbitHit: new Array<number>(MAX_ORBIT_SLOTS).fill(-10),
      knockX: 0,
      knockY: 0,
    };
    this.enemies.push(boss);
    hud.boss = { name: def.name, hp, maxHp: hp, phase: 1 };
    bus.emit('sfx', 'boss');
    bus.emit(EV.banner, {
      text: 'FATAL: SEGFAULT',
      sub: '0xDEAD has entered the runtime',
      ms: 2200,
    });
  }

  private ringPosition(): { x: number; y: number } | null {
    const cam = this.cameras.main;
    const halfW = viewWidth(cam) / 2 + SPAWN.ringPadding;
    const halfH = viewHeight(cam) / 2 + SPAWN.ringPadding;
    const margin = 40;
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = this.rng.range(0, TAU);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const ratio = Math.max(Math.abs(cos) / halfW, Math.abs(sin) / halfH) || 1;
      const distance = (1 / ratio) * this.rng.range(1, 1.2);
      const x = this.playerX + cos * distance;
      const y = this.playerY + sin * distance;
      if (x < margin || y < margin || x > WORLD.width - margin || y > WORLD.height - margin) continue;
      return { x, y };
    }
    return null;
  }

  private updateBeams(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        const last = this.beams.pop()!;
        if (i < this.beams.length) this.beams[i] = last;
      }
    }
  }

  private drawBeams(): void {
    const g = this.beamGraphics;
    g.clear();
    for (const b of this.beams) {
      const t = Math.max(0, b.life / b.maxLife);
      if (b.kind === 'ray') {
        const cos = Math.cos(b.angle);
        const sin = Math.sin(b.angle);
        const half = b.width * 0.5 * (0.6 + 0.4 * t);
        const x1 = b.x - sin * half;
        const y1 = b.y + cos * half;
        const x2 = b.x + sin * half;
        const y2 = b.y - cos * half;
        g.fillStyle(b.color, 0.35 * t);
        g.fillPoints(
          [
            new Phaser.Geom.Point(x1, y1),
            new Phaser.Geom.Point(x1 + cos * b.length, y1 + sin * b.length),
            new Phaser.Geom.Point(x2 + cos * b.length, y2 + sin * b.length),
            new Phaser.Geom.Point(x2, y2),
          ],
          true,
        );
        g.lineStyle(3, 0xffffff, 0.75 * t);
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x + cos * b.length, b.y + sin * b.length);
        g.strokePath();
      } else {
        const points: Phaser.Geom.Point[] = [new Phaser.Geom.Point(b.x, b.y)];
        const steps = Math.max(6, Math.ceil((b.spread / TAU) * 26));
        for (let i = 0; i <= steps; i++) {
          const a = b.angle - b.spread / 2 + (b.spread * i) / steps;
          points.push(new Phaser.Geom.Point(b.x + Math.cos(a) * b.length, b.y + Math.sin(a) * b.length));
        }
        g.fillStyle(b.color, 0.28 * t);
        g.fillPoints(points, true);
        g.lineStyle(2, b.color, 0.6 * t);
        g.strokePoints(points, true);
      }
    }
  }

  private checkLevelUp(): void {
    const run = this.run;
    while (run.xp >= this.xpNeed) {
      run.xp -= this.xpNeed;
      run.level += 1;
      run.pendingLevels += 1;
      this.xpNeed = xpForLevel(run.level);
    }
    if (run.pendingLevels > 0 && !this.choosing) {
      this.openUpgrades();
    }
  }

  private openUpgrades(): void {
    const choices = pickChoices(this.run, this.rng, 3);
    if (choices.length === 0) {
      this.run.pendingLevels = 0;
      this.choosing = false;
      return;
    }
    this.pendingChoices = choices;
    this.choosing = true;
    this.panelOpen = true;
    this.chooseTimer = 0.4;
    hud.choices = this.run.pendingLevels;
    this.cameras.main.flash(240, 0, 255, 65, false);
    bus.emit('sfx', 'levelup');
    this.fx.burst(this.playerX, this.playerY, PALETTE.green, 26, 260, 0.8, 0.85);
    bus.emit(EV.levelUp, {
      cards: choices.map((id) => toCard(this.run, id)),
      level: this.run.level,
      pending: this.run.pendingLevels,
    });
  }

  private applyChoice(index: number): void {
    if (!this.panelOpen || index < 0 || index >= this.pendingChoices.length) return;
    const id = this.pendingChoices[index];
    applyUpgrade(this.run, id);
    this.run.pendingLevels = Math.max(0, this.run.pendingLevels - 1);
    hud.choices = this.run.pendingLevels;
    this.pendingChoices = [];
    bus.emit('sfx', 'choose');
    this.fx.text(this.playerX, this.playerY - 44, `+${id.toUpperCase()}`, '#00ff41', 15);
    this.panelOpen = false;
    this.choosing = this.run.pendingLevels > 0;
    this.chooseTimer = 0.3;
    this.refreshHudLists();
  }

  private refreshHudLists(): void {
    hud.weapons = WEAPON_IDS.filter((id) => (this.run.weapons[id] ?? 0) > 0).map((id) => {
      const def = WEAPON_DEFS[id];
      const level = this.run.weapons[id] ?? 0;
      return { symbol: def.symbol, level, color: def.color, max: level >= def.maxLevel };
    });
    hud.passives = Object.entries(this.run.passives).map(([id, level]) => {
      const def = PASSIVE_DEFS[id as keyof typeof PASSIVE_DEFS];
      return { symbol: def.symbol, level, color: def.color, max: level >= def.maxLevel };
    });
    hud.version += 1;
  }

  private pruneEntities(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.dead) continue;
      if (e.sprite) this.images.release(e.sprite);
      const last = this.enemies.pop()!;
      if (i < this.enemies.length) this.enemies[i] = last;
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.dead) continue;
      if (p.sprite) this.images.release(p.sprite);
      const last = this.projectiles.pop()!;
      if (i < this.projectiles.length) this.projectiles[i] = last;
    }
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      if (!o.dead) continue;
      if (o.sprite) this.images.release(o.sprite);
      const last = this.orbs.pop()!;
      if (i < this.orbs.length) this.orbs[i] = last;
    }
  }
}
