import Phaser from 'phaser';
import {
  BOSS,
  BREAKPOINT,
  DAEMON,
  DEADLOCK,
  DEPTH,
  ENTRANCE,
  ITEM,
  MONO_FONT,
  ORB,
  PALETTE,
  PLAYER,
  SHIELD,
  SPAWN,
  TERRAIN,
  TEX_SCALE,
  THROWER,
  WORLD,
} from '../config';
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
  EvolutionId,
  Orb,
  PassiveId,
  Orbiter,
  Pickup,
  Projectile,
  RunState,
  UpgradeId,
  WeaponId,
} from '../core/types';
import { ITEM_DEFS, pickItemDrop } from '../data/items';
import type { ItemId } from '../data/items';
import {
  bossSummonPool,
  ENEMY_DEFS,
  SPAWN_POOL,
  breakpointCap,
  daemonCap,
  enemyDamageScale,
  enemyHpScale,
  enemySpeedScale,
  pickEnemyType,
  raceSprintFactor,
  spawnRate,
} from '../data/enemies';
import {
  BOMB_BURN,
  BOMB_CHAIN,
  CLONE_FOCUS,
  CLONE_SPREAD,
  DART_BOUNCE,
  DART_FOCUS,
  EVOLUTION_DEFS,
  EVOLUTION_LEVEL,
  ORBIT_REFLECT,
  ORBIT_WIDE,
  evolutionCandidates,
  evolutionsFor,
  isEvolutionWeapon,
} from '../data/evolutions';
import { rollBossRewards, rollRareModule } from '../data/rewards';
import type { BossReward } from '../data/rewards';
import {
  WEAPON_DEFS,
  WEAPON_IDS,
  bombBlast,
  bombCount,
  bombDamage,
  CLONE_DISTANCE,
  CLONE_SPIN,
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
  orbitSpin,
  ringSlotAngles,
  rayCount,
  rayDamage,
  rayWidth,
} from '../data/weapons';
import {
  CACHE_PASSIVE,
  GC_PASSIVE,
  PARALLEL_PASSIVE,
  PASSIVE_DEFS,
  PASSIVE_IDS,
  TYPESAFE_PASSIVE,
} from '../data/passives';
import {
  TERRAIN_EVENTS,
  ZONE_DEFS,
  generateTerrain,
  reshuffleZones,
} from '../data/terrain';
import type { PacketFragment, Terrain, TerrainEvent, TerrainZone } from '../data/terrain';
import { isZoneSpent, stepCharge, zoneHazard, zoneMods } from '../systems/terrain';
import type { ZoneMods } from '../systems/terrain';
import { Fx } from '../systems/fx';
import { dampOrbVelocity, homeOrbVelocity, orbTier } from '../systems/loot';
import { pointSegmentDistance } from '../systems/hazards';
import { reflectBullet } from '../systems/shield';
import {
  applyBossReward,
  applyEvolution,
  applyUpgrade,
  canEvolve,
  pickChoices,
  toBossRewardCard,
  toCard,
  toEvolutionCard,
  xpForLevel,
} from '../systems/progression';

interface BossEntrance {
  x: number;
  y: number;
  color: number;
  sprite: Phaser.GameObjects.Image | null;
  t: number;
  materialised: boolean;
  waveActive: boolean;
  waveDone: boolean;
  waveRadius: number;
  waveMax: number;
  ringAt: number;
  holdAt: number;
  returning: boolean;
  returnEnd: number;
}

interface BurnPatch {
  x: number;
  y: number;
  radius: number;
  damage: number;
  until: number;
  nextTick: number;
  fxAt: number;
}

interface ChainBlast {
  x: number;
  y: number;
  radius: number;
  damage: number;
  at: number;
  depth: number;
}

interface DeadlockLink {
  aId: number;
  bId: number;
  armAt: number;
  until: number;
  hitAt: number;
}

interface BreakpointMark {
  x: number;
  y: number;
  radius: number;
  damage: number;
  at: number;
  blastAt: number;
}

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
  private pickups: Pickup[] = [];
  private orbiters: Orbiter[] = [];
  private clones: Clone[] = [];
  private beams: Beam[] = [];
  private burnPatches: BurnPatch[] = [];
  private chainBlasts: ChainBlast[] = [];
  private deadlockLinks: DeadlockLink[] = [];
  private breakpointMarks: BreakpointMark[] = [];

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
  private pickupId = 1;
  private xpNeed = xpForLevel(1);
  private choosing = false;
  private paused = false;
  private chooseTimer = 0;
  private pendingChoices: UpgradeId[] = [];
  private pendingEvolutions: WeaponId[] = [];
  private pendingEvolutionCards: EvolutionId[] = [];
  private qaEvolutions: WeaponId[] = [];
  private pendingRewards: BossReward[] = [];
  private pendingFree = 0;
  private panelSource: 'level' | 'free' | 'evolution' | 'reward' = 'level';
  private lastPauseToggle = -1000;
  private panelOpen = false;
  private dartFocusId = 0;
  private dartStacks = 0;
  private dartFocusAt = -10;
  private eventChargeTime = TERRAIN.event.chargeTime;
  private commitDuration = TERRAIN.commit.duration;
  private commitNeed = TERRAIN.commit.need;
  private eventSpawnTimer = TERRAIN.event.spawnEvery;
  private commitSpawnTimer = 0;
  private activeCommit: TerrainEvent | null = null;
  private activeEvent: TerrainEvent | null = null;
  private nextEventAt = 0;
  private eventBag: TerrainEvent['kind'][] = [];
  private cacheTargetId = 0;
  private cacheStacks = 0;
  private cacheAt = -10;
  private parallelFxAt = -10;
  private gcCharge = 0;
  private gcLastPickup = -10;
  private gcSweeps = 0;
  private typesafeShield = false;
  private lastDamageAt = 0;
  private shieldSprite: Phaser.GameObjects.Image | null = null;
  private orbitPhase = 0;
  private clonePhase = 0;
  private orbiterSeq = 0;
  private orbLifeScale = 1;
  private entrance: BossEntrance | null = null;
  private activeBoss: Enemy | null = null;
  private terrain!: Terrain;
  private activeZone: TerrainZone | null = null;
  private zoneMods: ZoneMods = { speed: 1, cooldown: 1 };
  private zoneGraphics!: Phaser.GameObjects.Graphics;
  private zoneHalos: Phaser.GameObjects.Image[] = [];
  private zoneRings: Phaser.GameObjects.Image[] = [];
  private nextZoneShuffleAt = 0;
  private zoneLabels: Phaser.GameObjects.Text[] = [];
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
    this.pickups = [];
    this.orbiters = [];
    this.clones = [];
    this.beams = [];
    this.burnPatches = [];
    this.chainBlasts = [];
    this.deadlockLinks = [];
    this.breakpointMarks = [];
    this.weaponTimers.clear();
    this.spawnTimer = 1.2;
    this.nextBossAt = SPAWN.bossFirstAt;
    this.bossGeneration = 0;
    this.enemyId = 1;
    this.pickupId = 1;
    this.xpNeed = xpForLevel(1);
    this.choosing = false;
    this.paused = false;
    this.pendingChoices = [];
    this.pendingEvolutions = [];
    this.pendingEvolutionCards = [];
    this.qaEvolutions = [];
    this.pendingRewards = [];
    this.pendingFree = 0;
    this.panelSource = 'level';
    this.lastPauseToggle = -1000;
    this.panelOpen = false;
    this.dartFocusId = 0;
    this.dartStacks = 0;
    this.dartFocusAt = -10;
    this.eventChargeTime = this.readQaEventCharge();
    this.commitDuration = this.readQaCommitDuration();
    this.commitNeed = this.readQaCommitNeed();
    this.eventSpawnTimer = TERRAIN.event.spawnEvery;
    this.commitSpawnTimer = 0;
    this.activeCommit = null;
    this.activeEvent = null;
    this.nextEventAt = this.run.time + TERRAIN.eventSystem.firstDelay;
    this.eventBag = [];
    this.cacheTargetId = 0;
    this.cacheStacks = 0;
    this.cacheAt = -10;
    this.parallelFxAt = -10;
    this.gcCharge = 0;
    this.gcLastPickup = -10;
    this.gcSweeps = 0;
    this.typesafeShield = false;
    this.lastDamageAt = 0;
    this.shieldSprite = null;
    this.orbitPhase = 0;
    this.clonePhase = 0;
    this.orbiterSeq = 0;
    this.orbLifeScale = this.readQaOrbLife();
    this.entrance = null;
    this.activeBoss = null;
    this.activeZone = null;
    this.zoneMods = { speed: 1, cooldown: 1 };
    this.zoneLabels = [];
    this.zoneHalos = [];
    this.zoneRings = [];
    this.nextZoneShuffleAt = 0;
    this.invulnUntil = 0;
    this.knockVx = 0;
    this.knockVy = 0;
    this.lastRange = -1;
    hud.boss = null;
    hud.choices = 0;
    hud.damageFlash = 0;
    hud.gameOver = false;
    hud.paused = false;
    hud.events = [];
    hud.cache = null;
    hud.gc = null;
    hud.shield = false;
    hud.parallelHits = 0;
    hud.rareModules = 0;
    hud.hazards = { links: 0, marks: 0, breakpoints: 0, daemons: 0, empowered: 0 };
    hud.panel = null;
    hud.panelCards = 0;
    hud.version++;

    this.playerX = WORLD.width / 2;
    this.playerY = WORLD.height / 2;
    this.facing = -Math.PI / 2;
    this.run.pendingLevels = 1;
    this.applyQaSkip();
    this.applyQaPassives();
    this.applyQaEvolution();
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

    const seedParam = Number(new URLSearchParams(window.location.search).get('seed') ?? '0');
    const seed =
      Number.isFinite(seedParam) && seedParam > 0
        ? Math.floor(seedParam)
        : Math.floor(this.rng.next() * 0xffffffff);
    this.terrain = generateTerrain(seed);
    hud.seed = seed;
    hud.zones = this.terrain.zones.length;
    this.buildTerrain();
    this.applyQaEvent();

    this.rangeGraphics = this.add.graphics().setDepth(DEPTH.ground + 1);
    this.beamGraphics = this.add.graphics().setDepth(DEPTH.beam).setBlendMode(Phaser.BlendModes.ADD);

    this.playerSprite = this.add.image(this.playerX, this.playerY, 'player').setDepth(DEPTH.player);
    this.playerSprite.setBlendMode(Phaser.BlendModes.ADD);
    this.playerSprite.setTint(PALETTE.cyan);

    this.shieldSprite = this.add
      .image(this.playerX, this.playerY, 'zoneRing')
      .setDepth(DEPTH.player + 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(PALETTE.white)
      .setDisplaySize(TYPESAFE_PASSIVE.radius * 2, TYPESAFE_PASSIVE.radius * 2)
      .setVisible(false);

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
      if (!this.run.over && !this.choosing && !hud.confirming) this.togglePause();
    };
    keyboard.on('keydown-P', onPauseKey);
    keyboard.on('keydown-ESC', onPauseKey);
    keyboard.on('keydown-M', () => bus.emit(EV.sfxToggle, undefined));
    keyboard.on('keydown-E', () => this.interactEvent());

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
      hud.panel = null;
      hud.events = [];
      hud.cache = null;
      hud.gc = null;
      hud.shield = false;
    });

    applyTextResolution(this);
    this.time.delayedCall(120, () => {
      bus.emit(EV.banner, { text: 'npm run survive', sub: 'ENTER THE STACK', ms: 1800 });
    });
    this.fx.burst(this.playerX, this.playerY, PALETTE.cyan, 24, 220, 0.9, 0.9);
    this.nextZoneShuffleAt = this.run.time + TERRAIN.zoneShuffleEvery;
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 1 / 30);

    if (this.run.over) {
      this.fx.update(dt);
      this.updateBeams(dt);
      this.drawBeams();
      return;
    }

    if (this.entrance) {
      this.updateEntrance(dt);
      this.fx.update(dt);
      this.updateBeams(dt);
      this.drawBeams();
      this.pruneEntities();
      this.syncGridToCamera();
      hud.orbs = this.orbs.length;
      hud.enemies = this.enemies.length;
      hud.items = this.pickups.length;
      syncHud(this.run, this.xpNeed);
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
      if (this.pendingEvolutions.length > 0) {
        this.openEvolution();
      } else if (this.pendingRewards.length > 0) {
        this.openBossReward();
      } else if (this.run.pendingLevels > 0) {
        this.openUpgrades('level');
      } else if (this.pendingFree > 0) {
        this.openUpgrades('free');
      } else {
        this.choosing = false;
        hud.choices = 0;
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
    this.updatePassives();
    this.updateTerrain(dt);
    this.updateEnemies(dt);
    this.updateDeadlockLinks();
    this.updateBreakpointMarks();
    this.syncHazardHud();
    this.updateWeapons(dt);
    this.updateProjectiles(dt);
    this.updateBurn();
    this.updateChain();
    this.updateOrbs(dt);
    this.updatePickups(dt);
    this.updateSpawner(dt);
    this.updateBeams(dt);

    this.fx.update(dt);
    this.pruneEntities();
    hud.orbs = this.orbs.length;
    hud.enemies = this.enemies.length;
    hud.items = this.pickups.length;
    hud.player.x = this.playerX;
    hud.player.y = this.playerY;
    this.drawBeams();
    this.updateCamera();
    this.checkLevelUp();
    syncHud(this.run, this.xpNeed);
  }

  private readQaOrbLife(): number {
    if (typeof window === 'undefined') return 1;
    const value = Number(new URLSearchParams(window.location.search).get('orbLife') ?? '0');
    return Number.isFinite(value) && value > 0 ? value / ORB.lifetime : 1;
  }

  private applyQaSkip(): void {
    if (typeof window === 'undefined') return;
    const skip = Number(new URLSearchParams(window.location.search).get('skip') ?? '0');
    if (!Number.isFinite(skip) || skip <= 0) return;
    this.run.time = skip;
    const bossIndex = Math.max(0, Math.floor((skip - SPAWN.bossFirstAt) / SPAWN.bossEvery) + 1);
    this.nextBossAt = SPAWN.bossFirstAt + bossIndex * SPAWN.bossEvery;
    this.nextEventAt = skip + TERRAIN.eventSystem.firstDelay;
    this.spawnTimer = 0;
    const levels = Math.min(45, 1 + Math.floor(0.36 * Math.pow(skip, 0.79)));
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

  private applyQaPassives(): void {
    if (typeof window === 'undefined') return;
    const param = new URLSearchParams(window.location.search).get('passives');
    if (!param) return;
    for (const raw of param.split(',')) {
      const [name, value] = raw.trim().split(':');
      if (!PASSIVE_IDS.includes(name as PassiveId)) continue;
      const id = name as PassiveId;
      const max = PASSIVE_DEFS[id].maxLevel;
      const requested = value === undefined ? max : Number(value);
      const target = Number.isFinite(requested)
        ? Math.min(max, Math.max(0, Math.floor(requested)))
        : max;
      while ((this.run.passives[id] ?? 0) < target) applyUpgrade(this.run, id);
    }
  }

  private applyQaEvolution(): void {
    if (typeof window === 'undefined') return;
    const param = new URLSearchParams(window.location.search).get('evolve');
    if (!param) return;
    for (const raw of param.split(',')) {
      const id = raw.trim() as WeaponId;
      if (!isEvolutionWeapon(id)) continue;
      this.run.weapons[id] = Math.max(this.run.weapons[id] ?? 0, EVOLUTION_LEVEL);
      if (!this.qaEvolutions.includes(id)) this.qaEvolutions.push(id);
    }
  }

  private applyQaEvent(): void {
    if (typeof window === 'undefined' || !this.terrain) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('eventNear') === '1') this.spawnEvent('compile');
    else if (params.get('packetNear') === '1') this.spawnEvent('packet');
    else if (params.get('commitNear') === '1') this.spawnEvent('commit');
  }

  private readQaEventCharge(): number {
    if (typeof window === 'undefined') return TERRAIN.event.chargeTime;
    const value = Number(new URLSearchParams(window.location.search).get('eventCharge') ?? '0');
    return Number.isFinite(value) && value > 0 ? value : TERRAIN.event.chargeTime;
  }

  private readQaCommitDuration(): number {
    if (typeof window === 'undefined') return TERRAIN.commit.duration;
    const value = Number(new URLSearchParams(window.location.search).get('commitDuration') ?? '0');
    return Number.isFinite(value) && value > 0 ? value : TERRAIN.commit.duration;
  }

  private readQaCommitNeed(): number {
    if (typeof window === 'undefined') return TERRAIN.commit.need;
    const value = Number(new URLSearchParams(window.location.search).get('commitNeed') ?? '0');
    return Number.isFinite(value) && value > 0 ? value : TERRAIN.commit.need;
  }

  private readQaBossHp(): number {
    if (typeof window === 'undefined') return 1;
    const value = Number(new URLSearchParams(window.location.search).get('bossHp') ?? '0');
    return Number.isFinite(value) && value > 0 && value < 1 ? value : 1;
  }

  private togglePause(): void {
    const now = this.time.now;
    if (now - this.lastPauseToggle < 250) return;
    this.lastPauseToggle = now;
    this.paused = !this.paused;
    hud.paused = this.paused;
    bus.emit(EV.banner, { text: this.paused ? 'paused' : 'resumed', sub: '', ms: 700 });
  }

  private syncGridToCamera(): void {
    this.gridSprite.tilePositionX = this.cameras.main.scrollX;
    this.gridSprite.tilePositionY = this.cameras.main.scrollY;
  }

  private updateCamera(): void {
    this.syncGridToCamera();
    const range = this.run.stats.pickupRadius;
    if (range !== this.lastRange) {
      this.lastRange = range;
      this.rangeGraphics.clear();
      this.rangeGraphics.lineStyle(1.5, PALETTE.green, 0.16);
      this.rangeGraphics.strokeCircle(0, 0, range);
      this.rangeGraphics.setPosition(this.playerX, this.playerY);
    }
  }

  private buildTerrain(): void {
    const decor = this.add.graphics().setDepth(DEPTH.ground + 1);
    for (const piece of this.terrain.decor) {
      if (piece.kind === 'comment') {
        decor.fillStyle(0x14141f, 0.42);
        decor.fillRect(piece.x, piece.y, piece.w, piece.h);
        decor.lineStyle(1, 0x313244, 0.4);
        decor.strokeRect(piece.x + 0.5, piece.y + 0.5, piece.w, piece.h);

        decor.fillStyle(0x1b1b28, 0.5);
        decor.fillRect(piece.x, piece.y, 22, piece.h);
        decor.lineStyle(1, 0x313244, 0.35);
        decor.beginPath();
        decor.moveTo(piece.x + 22.5, piece.y);
        decor.lineTo(piece.x + 22.5, piece.y + piece.h);
        decor.strokePath();

        const lineHeight = 13;
        const rows = Math.max(2, Math.floor((piece.h - 20) / lineHeight));
        const seedRng = new Rng(piece.seed);
        for (let row = 0; row < rows; row++) {
          const y = piece.y + 12 + row * lineHeight;
          decor.fillStyle(0x585b70, 0.12);
          decor.fillRect(piece.x + 30, y, piece.w - 44, 3);
          const codeWidth = Math.max(24, (piece.w - 60) * seedRng.range(0.35, 1));
          decor.fillStyle(0x7f849c, seedRng.range(0.07, 0.16));
          decor.fillRect(piece.x + 38, y, codeWidth, 3);
          decor.fillStyle(0x45475a, 0.16);
          decor.fillRect(piece.x + 8, y, 6, 3);
        }
        decor.lineStyle(2, 0x45475a, 0.55);
        decor.beginPath();
        decor.moveTo(piece.x + 14, piece.y + 8);
        decor.lineTo(piece.x + 14, piece.y + 14);
        decor.lineTo(piece.x + 20, piece.y + 14);
        decor.strokePath();
        decor.beginPath();
        decor.moveTo(piece.x + piece.w - 20, piece.y + piece.h - 14);
        decor.lineTo(piece.x + piece.w - 14, piece.y + piece.h - 14);
        decor.lineTo(piece.x + piece.w - 14, piece.y + piece.h - 8);
        decor.strokePath();
      } else if (piece.kind === 'diff') {
        decor.fillStyle(0x00ff41, 0.05);
        decor.fillRect(piece.x, piece.y, piece.w, piece.h);
        decor.fillStyle(0xff0040, 0.04);
        decor.fillRect(piece.x + 20, piece.y + 5, Math.max(20, piece.w - 60), piece.h);
      } else if (piece.kind === 'region') {
        decor.fillStyle(0x89b4fa, 0.028);
        decor.fillRect(piece.x, piece.y, piece.w, piece.h);
        decor.lineStyle(1, 0x89b4fa, 0.16);
        decor.beginPath();
        decor.moveTo(piece.x, piece.y + 0.5);
        decor.lineTo(piece.x + piece.w, piece.y + 0.5);
        decor.strokePath();
      } else {
        decor.lineStyle(2, 0x585b70, 0.3);
        decor.beginPath();
        decor.moveTo(piece.x, piece.y + 0.5);
        decor.lineTo(piece.x + piece.w, piece.y + 0.5);
        decor.strokePath();
        decor.lineStyle(1, 0x45475a, 0.22);
        for (let i = 1; i <= 3; i++) {
          decor.beginPath();
          decor.moveTo(piece.x + 14 * i, piece.y + i * 4 + 0.5);
          decor.lineTo(piece.x + piece.w - 14 * i, piece.y + i * 4 + 0.5);
          decor.strokePath();
        }
      }
    }

    for (const zone of this.terrain.zones) {
      const def = ZONE_DEFS[zone.kind];
      const halo = this.add
        .image(zone.x, zone.y, 'zoneGlow')
        .setDepth(DEPTH.ground + 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(def.color);
      halo.setDisplaySize(zone.radius * 2, zone.radius * 2);
      halo.setAlpha(0.5);
      this.zoneHalos.push(halo);

      const ring = this.add
        .image(zone.x, zone.y, 'zoneRing')
        .setDepth(DEPTH.ground + 2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(def.color);
      ring.setDisplaySize(zone.radius * 2, zone.radius * 2);
      this.zoneRings.push(ring);

      const label = this.add
        .text(zone.x, zone.y - zone.radius + 30, `${def.label} ${def.name}`, {
          fontFamily: MONO_FONT,
          fontSize: '14px',
          color: `#${def.color.toString(16).padStart(6, '0')}`,
          fontStyle: 'bold',
          padding: { x: 6, y: 6 },
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.ground + 4);
      label.setStroke('#0d0d15', 4);
      label.setAlpha(0.7);
      this.zoneLabels.push(label);
    }

    this.zoneGraphics = this.add.graphics().setDepth(DEPTH.ground + 2).setBlendMode(Phaser.BlendModes.ADD);
    this.drawZones();
  }

  private drawZones(): void {
    const time = this.run.time;
    const g = this.zoneGraphics;
    g.clear();
    for (let i = 0; i < this.terrain.zones.length; i++) {
      const zone = this.terrain.zones[i];
      const def = ZONE_DEFS[zone.kind];
      const charge = def.good ? zone.charge : 1;
      const active = this.activeZone === zone;
      const strength = 0.35 + 0.65 * charge;

      const spent = isZoneSpent(zone.kind, zone.charge);
      const halo = this.zoneHalos[i];
      if (halo) {
        halo.setVisible(!spent);
        halo.setAlpha((active ? 0.8 : 0.4) * strength);
      }
      const ring = this.zoneRings[i];
      if (ring) {
        ring.setVisible(!spent);
        ring.setRotation(time * 0.06 + zone.id * 0.7);
        ring.setAlpha((active ? 0.95 : 0.55) * strength);
      }
      this.zoneLabels[i].setVisible(!spent);
      this.zoneLabels[i].setAlpha(active ? 1 : 0.55 + 0.25 * charge);
    }

    if (this.activeZone) {
      const zone = this.activeZone;
      const def = ZONE_DEFS[zone.kind];
      if (def.good && zone.charge < 0.999) {
        g.lineStyle(4, def.color, 0.7);
        g.beginPath();
        g.arc(zone.x, zone.y, zone.radius - 22, -Math.PI / 2, -Math.PI / 2 + TAU * zone.charge);
        g.strokePath();
      }
    }

    this.drawEvolvedBlasts(time);
    this.drawDaemonAuras(time);
    this.drawEmpoweredEnemies(time);
    this.drawBreakpointMarks(time);
    this.drawPacketFragments(time);
  }

  private drawPacketFragments(time: number): void {
    const event = this.activeEvent;
    if (!event || event.kind !== 'packet' || !event.engaged) return;
    const g = this.zoneGraphics;
    for (const fragment of event.fragments) {
      if (fragment.got) continue;
      const guarded = fragment.guards.length > 0 && this.alivePacketGuards(fragment) > 0;
      const color = guarded ? PALETTE.red : TERRAIN_EVENTS.packet.color;
      const pulse = 0.5 + 0.5 * Math.sin(time * 6 + fragment.x * 0.01);
      const radius = TERRAIN.packet.grabRadius;
      g.fillStyle(color, 0.06 + 0.06 * pulse);
      g.fillCircle(fragment.x, fragment.y, radius);
      g.lineStyle(3, color, 0.5 + 0.4 * pulse);
      g.strokeCircle(fragment.x, fragment.y, radius);
      if (guarded) {
        g.lineStyle(2, color, 0.35 + 0.3 * pulse);
        g.strokeCircle(fragment.x, fragment.y, radius + 8);
      }
      g.lineStyle(2, PALETTE.white, 0.35 + 0.35 * pulse);
      g.strokeCircle(fragment.x, fragment.y, 14 + 4 * pulse);
      g.beginPath();
      g.moveTo(fragment.x - 8, fragment.y);
      g.lineTo(fragment.x + 8, fragment.y);
      g.moveTo(fragment.x, fragment.y - 8);
      g.lineTo(fragment.x, fragment.y + 8);
      g.strokePath();
    }
  }

  private drawDaemonAuras(time: number): void {
    const g = this.zoneGraphics;
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.type !== 'daemon') continue;
      const pulse = 0.5 + 0.5 * Math.sin(time * 4 + enemy.id);
      g.fillStyle(PALETTE.purple, 0.035 + 0.02 * pulse);
      g.fillCircle(enemy.x, enemy.y, DAEMON.radius);
      g.lineStyle(3, PALETTE.purple, 0.45 + 0.2 * pulse);
      g.strokeCircle(enemy.x, enemy.y, DAEMON.radius);
      g.lineStyle(1, PALETTE.white, 0.12 + 0.08 * pulse);
      g.strokeCircle(enemy.x, enemy.y, DAEMON.radius - 3);
    }
  }

  private drawEmpoweredEnemies(time: number): void {
    const g = this.zoneGraphics;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const until = enemy.empoweredUntil ?? 0;
      if (until <= time) continue;
      const remain = Phaser.Math.Clamp((until - time) / DAEMON.linger, 0, 1);
      g.lineStyle(2, PALETTE.purple, 0.25 + 0.45 * remain);
      g.strokeCircle(enemy.x, enemy.y, enemy.radius + 5);
    }
  }

  private drawBreakpointMarks(time: number): void {
    const g = this.zoneGraphics;
    for (const mark of this.breakpointMarks) {
      const progress = Phaser.Math.Clamp((time - mark.at) / BREAKPOINT.arm, 0, 1);
      const pulse = 0.5 + 0.5 * Math.sin(time * 18);
      g.fillStyle(PALETTE.red, 0.12 + 0.08 * pulse);
      g.fillCircle(mark.x, mark.y, mark.radius);
      g.lineStyle(4, PALETTE.red, 0.75 + 0.2 * pulse);
      g.strokeCircle(mark.x, mark.y, mark.radius);
      g.lineStyle(2, PALETTE.white, 0.6 + 0.3 * (1 - progress));
      g.strokeCircle(mark.x, mark.y, mark.radius * (1 - 0.8 * progress));
      g.lineStyle(2, PALETTE.red, 0.55);
      g.beginPath();
      g.moveTo(mark.x - 10, mark.y);
      g.lineTo(mark.x + 10, mark.y);
      g.moveTo(mark.x, mark.y - 10);
      g.lineTo(mark.x, mark.y + 10);
      g.strokePath();
    }
  }

  private drawEvolvedBlasts(time: number): void {
    const g = this.zoneGraphics;
    for (const patch of this.burnPatches) {
      const life = Phaser.Math.Clamp((patch.until - time) / BOMB_BURN.duration, 0, 1);
      const pulse = 0.06 * Math.sin(time * 7 + patch.x);
      g.fillStyle(PALETTE.orange, 0.08 + 0.05 * life + pulse);
      g.fillCircle(patch.x, patch.y, patch.radius);
      g.lineStyle(2, PALETTE.orange, 0.25 + 0.25 * life);
      g.strokeCircle(patch.x, patch.y, patch.radius);
    }
    for (const blast of this.chainBlasts) {
      const progress = Phaser.Math.Clamp(1 - (blast.at - time) / BOMB_CHAIN.delay, 0, 1);
      const radius = blast.radius * (0.35 + 0.65 * progress);
      g.lineStyle(2, PALETTE.yellow, 0.35 + 0.5 * progress);
      g.strokeCircle(blast.x, blast.y, radius);
      g.lineStyle(1, PALETTE.orange, 0.25);
      g.strokeCircle(blast.x, blast.y, blast.radius);
    }
  }

  private collectedFragments(event: TerrainEvent): number {
    let got = 0;
    for (const fragment of event.fragments) if (fragment.got) got += 1;
    return got;
  }

  private eventDetail(event: TerrainEvent, time: number): string {
    const remaining = Math.max(0, Math.ceil(event.deadline - time));
    if (!event.engaged) return `${remaining}s`;
    if (event.kind === 'compile') {
      const speed = Math.round((1 - TERRAIN.event.compileAttackSpeed) * 100);
      const taken = Math.round((TERRAIN.event.compileDamageTaken - 1) * 100);
      return `${Math.round(event.charge * 100)}% · 攻速 -${speed}% · 受伤 +${taken}%`;
    }
    if (event.kind === 'packet') {
      let guards = 0;
      for (const fragment of event.fragments) {
        if (fragment.got || fragment.guards.length === 0) continue;
        guards += this.alivePacketGuards(fragment);
      }
      const tag = guards > 0 ? ` · 守卫 ${guards}` : '';
      return `碎片 ${this.collectedFragments(event)}/${event.fragments.length}${tag} · ${remaining}s`;
    }
    return `${event.kills}/${event.need} · ${remaining}s`;
  }

  private reshuffleTerrain(): void {
    const seed = Math.floor(this.rng.next() * 0xffffffff);
    const next = reshuffleZones(seed, this.terrain.zones, WORLD, {
      x: this.playerX,
      y: this.playerY,
      radius: PLAYER.radius,
    });
    this.terrain.zones = next;
    for (let i = 0; i < next.length; i++) {
      const zone = next[i];
      const def = ZONE_DEFS[zone.kind];
      const color = `#${def.color.toString(16).padStart(6, '0')}`;
      const halo = this.zoneHalos[i];
      if (halo) {
        halo.setPosition(zone.x, zone.y).setTint(def.color);
        halo.setDisplaySize(zone.radius * 2, zone.radius * 2);
      }
      const ring = this.zoneRings[i];
      if (ring) {
        ring.setPosition(zone.x, zone.y).setTint(def.color);
        ring.setDisplaySize(zone.radius * 2, zone.radius * 2);
      }
      const label = this.zoneLabels[i];
      if (label) {
        label.setVisible(true);
        label.setPosition(zone.x, zone.y - zone.radius + 30);
        label.setText(`${def.label} ${def.name}`);
        label.setColor(color);
      }
      this.zoneHalos[i]?.setVisible(true);
      this.zoneRings[i]?.setVisible(true);
    }
    this.activeZone = null;
    this.zoneMods = { speed: 1, cooldown: 1 };
    hud.zone = null;
    this.cameras.main.flash(200, 137, 180, 250, false);
    this.beams.push({
      kind: 'ring',
      x: this.playerX,
      y: this.playerY,
      angle: 0,
      length: 60,
      width: 4,
      spread: 0,
      color: PALETTE.blue,
      life: 0.65,
      maxLife: 0.65,
      grow: 12,
    });
    bus.emit('sfx', 'emp');
    bus.emit(EV.banner, { text: 'TERRAIN REBUILT', sub: 'code regions recompiled', ms: 1400 });
  }

  private updateTerrain(dt: number): void {
    if (this.run.time >= this.nextZoneShuffleAt) {
      this.nextZoneShuffleAt = this.run.time + TERRAIN.zoneShuffleEvery;
      this.reshuffleTerrain();
    }
    let active: TerrainZone | null = null;
    let best = Infinity;
    for (const zone of this.terrain.zones) {
      if (isZoneSpent(zone.kind, zone.charge)) continue;
      const dist = Math.hypot(zone.x - this.playerX, zone.y - this.playerY);
      if (dist <= zone.radius && dist < best) {
        best = dist;
        active = zone;
      }
    }
    for (const zone of this.terrain.zones) {
      const before = zone.charge;
      zone.charge = stepCharge(zone === active, zone.charge, dt);
      if (before > 0 && isZoneSpent(zone.kind, zone.charge)) {
        this.fx.burst(zone.x, zone.y, ZONE_DEFS[zone.kind].color, 26, 320, 0.7, 1);
        this.fx.text(zone.x, zone.y, `${ZONE_DEFS[zone.kind].label} drained`, '#7f849c', 15);
        bus.emit('sfx', 'explode');
      }
    }
    this.activeZone = active;
    this.zoneMods = zoneMods(active ? active.kind : null, active ? active.charge : 0);

    for (const zone of this.terrain.zones) {
      const hazard = zoneHazard(zone.kind);
      if (zone.kind !== 'leak' && hazard.enemyDps <= 0) continue;
      const list = this.grid.query(zone.x, zone.y, zone.radius, this.scratch2);
      for (let i = 0; i < list.length; i++) {
        const enemy = list[i];
        if (enemy.dead) continue;
        if (Math.hypot(enemy.x - zone.x, enemy.y - zone.y) > zone.radius) continue;
        if (zone.kind === 'leak') enemy.slowUntil = this.run.time + 0.2;
        if (hazard.enemyDps > 0) this.damageEnemy(enemy, hazard.enemyDps * dt, false, 0, 0, false);
      }
    }

    if (active) {
      const hazard = zoneHazard(active.kind);
      if (hazard.playerDps > 0) this.damageOverTime(hazard.playerDps * dt);
    }

    if (active) {
      const def = ZONE_DEFS[active.kind];
      hud.zone = { label: def.label, name: def.name, charge: active.charge, good: def.good };
    } else {
      hud.zone = null;
    }

    this.updateEvents(dt);
    this.drawZones();
  }

  private maybeSpawnEvent(): void {
    if (this.activeEvent || this.run.time < this.nextEventAt || this.activeBoss) return;
    if (this.nextBossAt - this.run.time <= TERRAIN.eventSystem.bossBuffer) return;
    if (!this.spawnEvent(this.nextEventKind())) this.nextEventAt = this.run.time + 5;
  }

  private nextEventKind(): TerrainEvent['kind'] {
    if (this.eventBag.length === 0) {
      this.eventBag = this.rng.shuffle(['compile', 'packet', 'commit'] as TerrainEvent['kind'][]);
    }
    return this.eventBag.pop()!;
  }

  private eventHex(kind: TerrainEvent['kind']): string {
    return `#${TERRAIN_EVENTS[kind].color.toString(16).padStart(6, '0')}`;
  }

  private spawnEvent(kind: TerrainEvent['kind']): boolean {
    const time = this.run.time;
    const event: TerrainEvent = {
      id: 0,
      kind,
      charge: 0,
      done: false,
      deadline: time + TERRAIN.eventSystem.acceptWindow,
      engaged: false,
      fragments: [],
      kills: 0,
      need: kind === 'commit' ? this.commitNeed : 0,
    };
    this.activeEvent = event;
    this.activeCommit = null;
    this.eventSpawnTimer = TERRAIN.event.spawnEvery;
    this.commitSpawnTimer = 0;
    hud.events = [];
    const def = TERRAIN_EVENTS[kind];
    bus.emit(EV.banner, {
      text: 'NEW OBJECTIVE',
      sub: `${def.label} ${def.name} · press E to accept`,
      ms: 2400,
      color: this.eventHex(kind),
      emphasis: true,
    });
    bus.emit('sfx', 'levelup');
    return true;
  }

  private finishEvent(): void {
    this.activeEvent = null;
    this.activeCommit = null;
    this.nextEventAt = this.run.time + TERRAIN.eventSystem.cooldown;
    hud.events = [];
  }

  private interactEvent(): void {
    if (this.run.over || this.choosing || this.paused || this.entrance) return;
    const event = this.activeEvent;
    if (!event || event.done || event.engaged) return;
    if (event.kind === 'compile') {
      event.engaged = true;
      event.charge = 0;
      event.deadline = this.run.time + this.eventChargeTime;
      this.eventSpawnTimer = 0;
      bus.emit(EV.banner, {
        text: 'COMPILING',
        sub: 'attack speed down · damage taken up · enemies inbound',
        ms: 1300,
      });
      bus.emit('sfx', 'choose');
      return;
    }
    if (event.kind === 'packet') {
      this.engagePacket(event);
      return;
    }
    this.engageCommit(event);
  }

  private updateEvents(dt: number): void {
    this.maybeSpawnEvent();
    const event = this.activeEvent;
    if (!event) {
      hud.events = [];
      return;
    }
    const time = this.run.time;
    if (event.done) {
      this.finishEvent();
      return;
    }
    if (!event.engaged) {
      if (time >= event.deadline) {
        event.done = true;
        bus.emit(EV.banner, {
          text: 'OBJECTIVE EXPIRED',
          sub: `${TERRAIN_EVENTS[event.kind].name} · not accepted`,
          ms: 2200,
          color: '#ffa500',
          emphasis: true,
        });
        bus.emit('sfx', 'hurt');
        this.finishEvent();
        return;
      }
    } else if (event.kind === 'compile') {
      this.updateCompileEvent(event, dt);
    } else if (event.kind === 'packet') {
      this.updatePacketEvent(event);
    } else {
      this.updateCommitEvent(event, dt);
    }
    if (event.done) {
      this.finishEvent();
      return;
    }
    const def = TERRAIN_EVENTS[event.kind];
    const remaining = Math.max(0, event.deadline - time);
    let progress = 0;
    if (!event.engaged) {
      progress = 1 - remaining / TERRAIN.eventSystem.acceptWindow;
    } else if (event.kind === 'compile') {
      progress = event.charge;
    } else if (event.kind === 'packet') {
      progress = this.collectedFragments(event) / Math.max(1, event.fragments.length);
    } else {
      progress = event.kills / Math.max(1, event.need);
    }
    hud.events = [
      {
        kind: event.kind,
        label: def.label,
        name: def.name,
        color: def.color,
        charge: event.kind === 'compile' ? event.charge : 0,
        progress: Phaser.Math.Clamp(progress, 0, 1),
        active: event.engaged,
        interactable: !event.engaged,
        detail: this.eventDetail(event, time),
        fragments:
          event.kind === 'packet'
            ? event.fragments.map((f) => ({
                x: f.x,
                y: f.y,
                got: f.got,
                guards: f.guards.slice(),
              }))
            : [],
      },
    ];
  }

  private updateCompileEvent(event: TerrainEvent, dt: number): void {
    const time = this.run.time;
    event.charge = Phaser.Math.Clamp(
      1 - (event.deadline - time) / this.eventChargeTime,
      0,
      1,
    );
    this.eventSpawnTimer -= dt;
    if (this.eventSpawnTimer <= 0) {
      this.eventSpawnTimer = TERRAIN.event.spawnEvery;
      this.spawnEventWave();
    }
    if (time >= event.deadline) this.completeCompileEvent(event);
  }

  private updatePacketEvent(event: TerrainEvent): void {
    const time = this.run.time;
    let got = 0;
    for (const fragment of event.fragments) {
      if (fragment.got) {
        got += 1;
        continue;
      }
      const dx = this.playerX - fragment.x;
      const dy = this.playerY - fragment.y;
      const dist2 = dx * dx + dy * dy;
      if (fragment.guards.length === 0) {
        if (dist2 <= TERRAIN.packet.guardRadius ** 2) this.deployPacketGuards(fragment);
        continue;
      }
      if (this.alivePacketGuards(fragment) > 0) continue;
      if (dist2 > TERRAIN.packet.grabRadius ** 2) continue;
      fragment.got = true;
      got += 1;
      this.fx.burst(fragment.x, fragment.y, TERRAIN_EVENTS.packet.color, 18, 280, 0.5, 0.85);
      this.beams.push({
        kind: 'ring',
        x: fragment.x,
        y: fragment.y,
        angle: 0,
        length: 26,
        width: 5,
        spread: 0,
        color: TERRAIN_EVENTS.packet.color,
        life: 0.35,
        maxLife: 0.35,
        grow: 9,
      });
      const label = `FRAGMENT ${got}/${event.fragments.length}`;
      this.fx.text(fragment.x, fragment.y - 34, label, '#00ffff', 14);
      bus.emit('sfx', 'pickup');
    }
    if (event.fragments.length > 0 && got >= event.fragments.length) {
      this.completePacket(event);
      return;
    }
    if (time >= event.deadline) this.failPacket(event);
  }

  private alivePacketGuards(fragment: PacketFragment): number {
    let alive = 0;
    for (const id of fragment.guards) {
      if (this.enemies.some((enemy) => enemy.id === id && !enemy.dead)) alive += 1;
    }
    return alive;
  }

  private deployPacketGuards(fragment: PacketFragment): void {
    const kinds: EnemyTypeId[] = ['race', 'memleak', 'thrower'];
    const total = TERRAIN.packet.guards;
    for (let i = 0; i < total; i++) {
      const angle = (i / total) * TAU + this.rng.range(-0.4, 0.4);
      const x = Phaser.Math.Clamp(
        fragment.x + Math.cos(angle) * TERRAIN.packet.guardGap,
        40,
        WORLD.width - 40,
      );
      const y = Phaser.Math.Clamp(
        fragment.y + Math.sin(angle) * TERRAIN.packet.guardGap,
        40,
        WORLD.height - 40,
      );
      const guard = this.spawnEnemy(kinds[i % kinds.length], x, y, true);
      if (!guard) continue;
      guard.summoned = true;
      guard.color = TERRAIN_EVENTS.packet.color;
      guard.hp *= TERRAIN.packet.guardHpScale;
      guard.maxHp *= TERRAIN.packet.guardHpScale;
      guard.damage *= TERRAIN.packet.guardDamageScale;
      if (guard.sprite) guard.sprite.setTint(guard.color);
      fragment.guards.push(guard.id);
    }
    if (fragment.guards.length === 0) return;
    this.fx.burst(fragment.x, fragment.y, TERRAIN_EVENTS.packet.color, 20, 260, 0.5, 0.85);
    this.fx.text(fragment.x, fragment.y - 46, 'PACKET GUARDED', '#ff0040', 14);
    bus.emit('sfx', 'shoot');
  }

  private updateCommitEvent(event: TerrainEvent, dt: number): void {
    this.commitSpawnTimer -= dt;
    if (this.commitSpawnTimer <= 0) {
      this.commitSpawnTimer = TERRAIN.commit.spawnEvery;
      for (let i = 0; i < TERRAIN.commit.spawnCount; i++) this.spawnChallengeEnemy();
    }
    if (event.kills >= event.need) {
      this.completeCommit(event);
      return;
    }
    if (this.run.time >= event.deadline) this.failCommit(event);
  }

  private engagePacket(event: TerrainEvent): void {
    event.engaged = true;
    event.deadline = this.run.time + TERRAIN.packet.collectTime;
    event.fragments = [];
    const total = TERRAIN.packet.fragments;
    for (let i = 0; i < total; i++) {
      let spot = this.packetFragmentSpot((i / total) * TAU + this.rng.range(-0.35, 0.35));
      for (let attempt = 0; attempt < 12 && this.tooCloseToFragment(event.fragments, spot); attempt++) {
        spot = this.packetFragmentSpot(this.rng.range(0, TAU));
      }
      event.fragments.push({ x: spot.x, y: spot.y, got: false, guards: [] });
    }
    this.fx.burst(this.playerX, this.playerY, TERRAIN_EVENTS.packet.color, 26, 320, 0.6, 0.9);
    this.cameras.main.flash(140, 0, 255, 255, false);
    bus.emit('sfx', 'emp');
    bus.emit(EV.banner, {
      text: 'PACKET OPENED',
      sub: `${total} fragments scattered · collect them before the deadline`,
      ms: 1600,
      color: this.eventHex('packet'),
      emphasis: true,
    });
  }

  private packetFragmentSpot(angle: number): { x: number; y: number } {
    const distance = this.rng.range(TERRAIN.packet.fragmentMin, TERRAIN.packet.fragmentMax);
    return {
      x: Phaser.Math.Clamp(this.playerX + Math.cos(angle) * distance, 60, WORLD.width - 60),
      y: Phaser.Math.Clamp(this.playerY + Math.sin(angle) * distance, 60, WORLD.height - 60),
    };
  }

  private tooCloseToFragment(fragments: PacketFragment[], spot: { x: number; y: number }): boolean {
    return fragments.some(
      (fragment) => Math.hypot(fragment.x - spot.x, fragment.y - spot.y) < TERRAIN.packet.fragmentGap,
    );
  }

  private completePacket(event: TerrainEvent): void {
    event.done = true;
    const candidates = evolutionCandidates(this.run, this.pendingEvolutions);
    if (candidates.length > 0) {
      const weapon = candidates.sort(
        (a, b) =>
          (this.run.weapons[b] ?? 0) - (this.run.weapons[a] ?? 0) ||
          WEAPON_IDS.indexOf(a) - WEAPON_IDS.indexOf(b),
      )[0];
      this.queueEvolution(weapon, false);
      this.chooseTimer = 0.5;
      bus.emit(EV.banner, {
        text: 'PACKET RESTORED',
        sub: `${WEAPON_DEFS[weapon].name} · evolution unlocked`,
        ms: 1600,
      });
    } else {
      this.pendingFree += 1;
      this.choosing = true;
      this.chooseTimer = 0.5;
      hud.choices = this.pendingChoiceCount();
      bus.emit(EV.banner, {
        text: 'PACKET RESTORED',
        sub: 'no evolution target · free module',
        ms: 2200,
        color: this.eventHex('packet'),
        emphasis: true,
      });
    }
    this.fx.burst(this.playerX, this.playerY, TERRAIN_EVENTS.packet.color, 30, 380, 0.7, 1);
    this.beams.push({
      kind: 'ring',
      x: this.playerX,
      y: this.playerY,
      angle: 0,
      length: 40,
      width: 6,
      spread: 0,
      color: TERRAIN_EVENTS.packet.color,
      life: 0.6,
      maxLife: 0.6,
      grow: 10,
    });
    this.cameras.main.flash(160, 0, 255, 255, false);
    bus.emit('sfx', 'levelup');
  }

  private failPacket(event: TerrainEvent): void {
    event.done = true;
    this.fx.burst(this.playerX, this.playerY, PALETTE.red, 18, 260, 0.5, 0.8);
    bus.emit('sfx', 'hurt');
    bus.emit(EV.banner, {
      text: 'PACKET LOST',
      sub: 'fragments left behind · no evolution',
      ms: 2200,
      color: '#ff0040',
      emphasis: true,
    });
  }

  private engageCommit(event: TerrainEvent): void {
    event.engaged = true;
    event.deadline = this.run.time + this.commitDuration;
    event.kills = 0;
    event.need = this.commitNeed;
    this.activeCommit = event;
    this.commitSpawnTimer = 0;
    this.fx.burst(this.playerX, this.playerY, TERRAIN_EVENTS.commit.color, 30, 360, 0.7, 1);
    this.cameras.main.flash(160, 255, 0, 64, false);
    bus.emit('sfx', 'boss');
    bus.emit(EV.banner, {
      text: 'COMMIT ACCEPTED',
      sub: `kill ${event.need} stronger processes in ${this.commitDuration}s`,
      ms: 1700,
      color: this.eventHex('commit'),
      emphasis: true,
    });
  }

  private spawnChallengeEnemy(): void {
    const enemy = this.spawnEnemy();
    if (!enemy) return;
    enemy.challenge = true;
    enemy.hp *= TERRAIN.commit.hpScale;
    enemy.maxHp *= TERRAIN.commit.hpScale;
    enemy.damage *= TERRAIN.commit.damageScale;
    enemy.color = PALETTE.orange;
    if (enemy.sprite) enemy.sprite.setTint(enemy.color);
  }

  private completeCommit(event: TerrainEvent): void {
    if (event.done) return;
    event.done = true;
    if (this.activeCommit === event) this.activeCommit = null;
    const reward = rollRareModule(this.rng);
    applyBossReward(this.run, reward);
    hud.rareModules += 1;
    this.refreshHudLists();
    this.fx.burst(this.playerX, this.playerY, TERRAIN_EVENTS.commit.color, 30, 380, 0.7, 1);
    this.cameras.main.flash(160, 255, 0, 64, false);
    bus.emit('sfx', 'levelup');
    bus.emit(EV.banner, {
      text: 'COMMIT MERGED',
      sub: reward.name,
      ms: 2200,
      color: this.eventHex('commit'),
      emphasis: true,
    });
  }

  private failCommit(event: TerrainEvent): void {
    event.done = true;
    if (this.activeCommit === event) this.activeCommit = null;
    this.fx.burst(this.playerX, this.playerY, PALETTE.red, 16, 240, 0.5, 0.8);
    bus.emit('sfx', 'hurt');
    bus.emit(EV.banner, {
      text: 'COMMIT REVERTED',
      sub: 'quota missed · no module',
      ms: 2200,
      color: '#ff0040',
      emphasis: true,
    });
  }

  private spawnEventWave(): void {
    for (let i = 0; i < TERRAIN.event.spawnCount; i++) this.spawnEnemy();
    this.fx.burst(this.playerX, this.playerY, TERRAIN_EVENTS.compile.color, 10, 210, 0.5, 0.7);
    bus.emit('sfx', 'shoot');
  }

  private completeCompileEvent(event: TerrainEvent): void {
    event.done = true;
    event.charge = 1;
    this.pendingFree += 1;
    this.choosing = true;
    this.chooseTimer = 0.6;
    hud.choices = this.pendingChoiceCount();
    this.fx.burst(this.playerX, this.playerY, TERRAIN_EVENTS.compile.color, 30, 360, 0.8, 1);
    this.beams.push({
      kind: 'ring',
      x: this.playerX,
      y: this.playerY,
      angle: 0,
      length: 40,
      width: 6,
      spread: 0,
      color: TERRAIN_EVENTS.compile.color,
      life: 0.6,
      maxLife: 0.6,
      grow: 10,
    });
    this.cameras.main.flash(200, 255, 224, 102, false);
    bus.emit('sfx', 'levelup');
    bus.emit(EV.banner, {
      text: 'COMPILE COMPLETE',
      sub: 'free module unlocked',
      ms: 2200,
      color: this.eventHex('compile'),
      emphasis: true,
    });
  }

  private damageOverTime(amount: number): void {
    if (this.run.over || amount <= 0) return;
    this.lastDamageAt = this.run.time;
    if (this.typesafeShield) {
      this.breakShield();
      return;
    }
    this.run.hp -= amount * this.eventDamageTakenMult();
    if (this.run.hp <= 0) {
      this.run.hp = 0;
      this.endRun();
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
      this.playerX += dx * stats.speed * this.zoneMods.speed * dt;
      this.playerY += dy * stats.speed * this.zoneMods.speed * dt;
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
    if (this.shieldSprite) {
      if (this.typesafeShield) {
        this.shieldSprite.setVisible(true);
        this.shieldSprite.setPosition(this.playerX, this.playerY);
        this.shieldSprite.setRotation(this.run.time * 0.6);
        this.shieldSprite.setAlpha(0.55 + 0.25 * Math.sin(this.run.time * 5));
      } else {
        this.shieldSprite.setVisible(false);
      }
    }
  }

  private updatePassives(): void {
    const time = this.run.time;
    if (this.cacheStacks > 0 && time - this.cacheAt > CACHE_PASSIVE.window) {
      this.cacheStacks = 0;
    }
    if (this.gcCharge > 0 && time - this.gcLastPickup > GC_PASSIVE.window) {
      this.gcCharge = 0;
    }
    const typesafe = this.run.passives.typesafe ?? 0;
    if (typesafe > 0 && !this.typesafeShield && time - this.lastDamageAt >= TYPESAFE_PASSIVE.delay(typesafe)) {
      this.typesafeShield = true;
      this.fx.burst(this.playerX, this.playerY, PALETTE.white, 16, 220, 0.5, 0.8);
      this.fx.text(this.playerX, this.playerY - 40, 'TYPE SAFE', '#cdd6f4', 14);
      bus.emit('sfx', 'pickup');
    }
    this.syncPassiveHud();
  }

  private syncPassiveHud(): void {
    const cacheLevel = this.run.passives.cache ?? 0;
    hud.cache =
      cacheLevel > 0 ? { stacks: this.cacheStacks, max: CACHE_PASSIVE.maxStacks } : null;
    const gcLevel = this.run.passives.gc ?? 0;
    hud.gc =
      gcLevel > 0
        ? { charge: this.gcCharge, need: GC_PASSIVE.threshold(gcLevel), sweeps: this.gcSweeps }
        : null;
    hud.shield = this.typesafeShield;
  }

  private registerFocusTarget(id: number | null): void {
    if (id === null || id === 0) return;
    if ((this.run.passives.cache ?? 0) <= 0) return;
    if (this.run.time - this.cacheAt > CACHE_PASSIVE.window) this.cacheStacks = 0;
    if (this.cacheTargetId === id) {
      this.cacheStacks = Math.min(CACHE_PASSIVE.maxStacks, this.cacheStacks + 1);
    } else {
      this.cacheTargetId = id;
      this.cacheStacks = 0;
    }
    this.cacheAt = this.run.time;
  }

  private cacheSpeedMult(): number {
    const level = this.run.passives.cache ?? 0;
    if (level <= 0 || this.cacheStacks <= 0) return 1;
    return 1 + this.cacheStacks * CACHE_PASSIVE.perStack(level);
  }

  private cacheCooldownMult(): number {
    return 1 / this.cacheSpeedMult();
  }

  private compileActive(): boolean {
    const event = this.activeEvent;
    return event !== null && event.kind === 'compile' && event.engaged && !event.done;
  }

  private eventAttackSpeedMult(): number {
    return this.compileActive() ? TERRAIN.event.compileAttackSpeed : 1;
  }

  private eventCooldownMult(): number {
    return 1 / this.eventAttackSpeedMult();
  }

  private eventDamageTakenMult(): number {
    return this.compileActive() ? TERRAIN.event.compileDamageTaken : 1;
  }

  private registerXpPickup(count: number): void {
    const level = this.run.passives.gc ?? 0;
    if (level <= 0 || count <= 0) return;
    if (this.run.time - this.gcLastPickup > GC_PASSIVE.window) this.gcCharge = 0;
    this.gcLastPickup = this.run.time;
    this.gcCharge += count;
    const need = GC_PASSIVE.threshold(level);
    if (this.gcCharge < need) return;
    this.gcCharge = 0;
    this.gcSweeps += 1;
    this.sweepGc(level);
  }

  private sweepGc(level: number): void {
    const radius = GC_PASSIVE.radius(level);
    const damage = GC_PASSIVE.damage(level) * this.run.stats.damageMult;
    const list = this.grid.query(this.playerX, this.playerY, radius, this.scratch2);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.x - this.playerX;
      const dy = e.y - this.playerY;
      const dist = Math.hypot(dx, dy);
      if (dist > radius + e.radius) continue;
      this.damageEnemy(e, damage, false, (dx / (dist || 1)) * 220, (dy / (dist || 1)) * 220, true);
    }
    this.fx.burst(this.playerX, this.playerY, PALETTE.purple, 24, 320, 0.6, 0.9);
    this.beams.push({
      kind: 'ring',
      x: this.playerX,
      y: this.playerY,
      angle: 0,
      length: 40,
      width: 6,
      spread: 0,
      color: PALETTE.purple,
      life: 0.5,
      maxLife: 0.5,
      grow: 8,
    });
    this.fx.text(this.playerX, this.playerY - 48, 'GC SWEEP', '#bd5fff', 16);
    bus.emit('sfx', 'emp');
  }

  private breakShield(): void {
    this.typesafeShield = false;
    this.lastDamageAt = this.run.time;
    this.fx.burst(this.playerX, this.playerY, PALETTE.white, 20, 260, 0.55, 0.9);
    this.fx.text(this.playerX, this.playerY - 34, 'TYPE SAFE', '#cdd6f4', 16);
    this.cameras.main.flash(120, 205, 214, 244, false);
    bus.emit('sfx', 'hit');
  }

  private updateEnemies(dt: number): void {
    const time = this.run.time;
    const px = this.playerX;
    const py = this.playerY;
    const speedScale = enemySpeedScale(time);
    this.updateEnemyAuras();

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
      if (e.type === 'race') {
        speed *= raceSprintFactor(dist);
        if (e.sprite) e.sprite.setAlpha(0.7 + 0.3 * Math.abs(Math.sin(time * 7 + e.id)));
      }
      if (e.type === 'thrower') {
        if (dist < THROWER.retreatDistance) speed = -speed * 0.75;
        else if (dist < THROWER.holdDistance) speed *= 0.22;
        e.castAt -= dt;
        if (e.castAt <= 0 && dist < THROWER.range) {
          e.castAt = THROWER.castEvery;
          this.throwerVolley(e);
        }
      }
      if (e.type === 'breakpoint') {
        if (dist < BREAKPOINT.retreatDistance) speed = -speed * 0.7;
        else if (dist < BREAKPOINT.holdDistance) speed *= 0.2;
        e.castAt -= dt;
        if (e.castAt <= 0 && dist < BREAKPOINT.range) {
          e.castAt = BREAKPOINT.castEvery;
          this.castBreakpointMark(e);
        }
      }
      if ((e.empoweredUntil ?? 0) > time) speed *= DAEMON.speed;
      if (e.slowUntil !== undefined && e.slowUntil > time) speed *= TERRAIN.effects.leakSpeed;
      if (e.boss) {
        speed *= 1 + (this.bossPhase(e) - 1) * 0.22;
      }

      e.vx = nx * speed;
      e.vy = ny * speed;

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

  private syncHazardHud(): void {
    let breakpoints = 0;
    let daemons = 0;
    let empowered = 0;
    const time = this.run.time;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      if (enemy.type === 'breakpoint') breakpoints += 1;
      if (enemy.type === 'daemon') daemons += 1;
      if ((enemy.empoweredUntil ?? 0) > time) empowered += 1;
    }
    hud.hazards = {
      links: this.deadlockLinks.length,
      marks: this.breakpointMarks.length,
      breakpoints,
      daemons,
      empowered,
    };
  }

  private isTypeCapped(id: EnemyTypeId): boolean {
    const cap =
      id === 'breakpoint'
        ? breakpointCap(this.run.time)
        : id === 'daemon'
          ? daemonCap(this.run.time)
          : 0;
    if (cap <= 0) return false;
    let alive = 0;
    for (const enemy of this.enemies) {
      if (!enemy.dead && enemy.type === id) alive += 1;
    }
    return alive >= cap;
  }

  private pickSpawnType(): EnemyTypeId {
    const time = this.run.time;
    for (let attempt = 0; attempt < 6; attempt++) {
      const id = pickEnemyType(time, this.rng.next());
      if (!this.isTypeCapped(id)) return id;
    }
    const fallback = SPAWN_POOL.filter(
      (id) => ENEMY_DEFS[id].unlockAt <= time && !this.isTypeCapped(id),
    );
    return fallback.length > 0 ? this.rng.pick(fallback) : 'syntax';
  }

  private updateEnemyAuras(): void {
    const time = this.run.time;
    const daemons = this.enemies.filter((enemy) => !enemy.dead && enemy.type === 'daemon');
    if (daemons.length === 0) return;
    for (const daemon of daemons) {
      const candidates: Enemy[] = [];
      for (const enemy of this.enemies) {
        if (enemy.dead || enemy.type === 'daemon') continue;
        const dx = enemy.x - daemon.x;
        const dy = enemy.y - daemon.y;
        if (dx * dx + dy * dy <= DAEMON.radius * DAEMON.radius) candidates.push(enemy);
      }
      candidates.sort(
        (a, b) =>
          (a.x - daemon.x) ** 2 +
          (a.y - daemon.y) ** 2 -
          ((b.x - daemon.x) ** 2 + (b.y - daemon.y) ** 2),
      );
      const count = Math.min(DAEMON.maxTargets, candidates.length);
      for (let i = 0; i < count; i++) candidates[i].empoweredUntil = time + DAEMON.linger;
    }
  }

  private isDeadlockLinked(id: number): boolean {
    return this.deadlockLinks.some((link) => link.aId === id || link.bId === id);
  }

  private findEnemy(id: number): Enemy | null {
    return this.enemies.find((enemy) => enemy.id === id && !enemy.dead) ?? null;
  }

  private updateDeadlockLinks(): void {
    const time = this.run.time;
    for (let i = this.deadlockLinks.length - 1; i >= 0; i--) {
      const link = this.deadlockLinks[i];
      const a = this.findEnemy(link.aId);
      const b = this.findEnemy(link.bId);
      if (!a || !b || time >= link.until) {
        const last = this.deadlockLinks.pop()!;
        if (i < this.deadlockLinks.length) this.deadlockLinks[i] = last;
        continue;
      }
      if (time < link.armAt) continue;
      const distance = pointSegmentDistance(this.playerX, this.playerY, a.x, a.y, b.x, b.y);
      if (distance > PLAYER.radius + DEADLOCK.thickness) continue;
      if (time - link.hitAt < DEADLOCK.hitEvery) continue;
      link.hitAt = time;
      const buff =
        (a.empoweredUntil ?? 0) > time || (b.empoweredUntil ?? 0) > time ? DAEMON.damage : 1;
      const damage = DEADLOCK.damage * buff * enemyDamageScale(time);
      this.hurtPlayer(Math.max(1, damage - this.run.stats.armor));
      this.fx.burst(this.playerX, this.playerY, PALETTE.cyan, 6, 150, 0.35, 0.5);
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.dead || a.type !== 'deadlock' || a.castAt > time || this.isDeadlockLinked(a.id)) continue;
      let partner: Enemy | null = null;
      let best = DEADLOCK.pairRange;
      for (let j = 0; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b === a || b.dead || b.type !== 'deadlock' || b.castAt > time || this.isDeadlockLinked(b.id)) {
          continue;
        }
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance <= best) {
          best = distance;
          partner = b;
        }
      }
      if (!partner) continue;
      const armAt = time + DEADLOCK.arm;
      const until = armAt + DEADLOCK.duration;
      this.deadlockLinks.push({ aId: a.id, bId: partner.id, armAt, until, hitAt: -10 });
      a.castAt = until + DEADLOCK.cooldown;
      partner.castAt = until + DEADLOCK.cooldown;
      this.fx.burst(
        (a.x + partner.x) / 2,
        (a.y + partner.y) / 2,
        PALETTE.cyan,
        10,
        180,
        0.4,
        0.6,
      );
    }
  }

  private castBreakpointMark(e: Enemy): void {
    const now = this.run.time;
    this.breakpointMarks.push({
      x: this.playerX,
      y: this.playerY,
      radius: BREAKPOINT.radius,
      damage:
        BREAKPOINT.damage *
        ((e.empoweredUntil ?? 0) > now ? DAEMON.damage : 1) *
        enemyDamageScale(now),
      at: now,
      blastAt: now + BREAKPOINT.arm,
    });
    if (this.breakpointMarks.length > 12) this.breakpointMarks.shift();
    this.fx.burst(e.x, e.y, PALETTE.red, 6, 120, 0.3, 0.5);
    this.fx.text(this.playerX, this.playerY - 48, '! INCOMING', '#ff0040', 14);
    bus.emit('sfx', 'shoot');
  }

  private updateBreakpointMarks(): void {
    const time = this.run.time;
    for (let i = this.breakpointMarks.length - 1; i >= 0; i--) {
      const mark = this.breakpointMarks[i];
      if (time < mark.blastAt) continue;
      const last = this.breakpointMarks.pop()!;
      if (i < this.breakpointMarks.length) this.breakpointMarks[i] = last;
      this.fx.burst(mark.x, mark.y, PALETTE.red, 20, 300, 0.55, 0.9);
      this.beams.push({
        kind: 'ring',
        x: mark.x,
        y: mark.y,
        angle: 0,
        length: mark.radius,
        width: 5,
        spread: 0,
        color: PALETTE.red,
        life: 0.35,
        maxLife: 0.35,
        grow: 0.18,
      });
      this.cameras.main.shake(120, 0.004);
      bus.emit('sfx', 'explode');
      if (Math.hypot(this.playerX - mark.x, this.playerY - mark.y) <= mark.radius + PLAYER.radius) {
        this.hurtPlayer(Math.max(1, mark.damage - this.run.stats.armor));
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
    const buff = (e.empoweredUntil ?? 0) > this.run.time ? DAEMON.damage : 1;
    const damage = Math.max(1, e.damage * buff - this.run.stats.armor);
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
    if (this.typesafeShield) {
      this.breakShield();
      this.invulnUntil = this.run.time + PLAYER.invulnTime;
      return;
    }
    const incoming = Math.max(1, damage * this.eventDamageTakenMult());
    this.run.hp -= incoming;
    this.lastDamageAt = this.run.time;
    this.invulnUntil = this.run.time + PLAYER.invulnTime;
    hud.damageFlash = 1;
    this.cameras.main.shake(160, 0.006);
    this.fx.text(this.playerX, this.playerY - 34, 'ERROR', '#ff0040', 16);
    this.fx.burst(this.playerX, this.playerY, PALETTE.red, 10, 180, 0.5, 0.7);
    if (this.run.hp <= 0) {
      this.run.hp = 0;
      this.endRun();
    } else {
      bus.emit(EV.banner, { text: `-${Math.round(incoming)} HP`, sub: 'segmentation fault avoided', ms: 620 });
    }
  }

  private endRun(): void {
    this.run.over = true;
    hud.gameOver = true;
    hud.panel = null;
    hud.panelCards = 0;
    hud.events = [];
    hud.cache = null;
    hud.gc = null;
    hud.shield = false;
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
    if (hud.boss && hud.boss.phase !== phase) {
      hud.boss.phase = phase;
      this.announceBossPhase(e, phase);
    }
    this.updateBossSummons(e, dt, phase);
    if (phase === 1) this.bossBarrage(e, dt, dist, BOSS.barrage.phase1);
    else if (phase === 2) this.bossBarrage(e, dt, dist, BOSS.barrage.phase2);
    else this.bossSpiral(e, dt, dist);
  }

  private announceBossPhase(e: Enemy, phase: number): void {
    e.castAt = 0;
    e.spiralShots = 0;
    if (phase === 2) {
      e.summonQueue = BOSS.summon.openerVolleys;
      e.summonSize = BOSS.summon.openerPerVolley;
      e.summonAt = 0;
    }
    if (phase === 3) {
      e.spiralShots = BOSS.spiral.shots;
      e.spiralAt = 0;
      e.spiralAngle = this.rng.range(0, TAU);
    }
    const subs = ['thread spawned · barrage online', 'core dumping · spawning workers', 'heap corrupted · spiral overload'];
    this.cameras.main.flash(220, 255, 0, 64, false);
    this.cameras.main.shake(320, 0.01);
    this.fx.burst(e.x, e.y, phase === 3 ? PALETTE.cyan : PALETTE.red, 26, 340, 0.7, 1);
    this.beams.push({
      kind: 'ring',
      x: e.x,
      y: e.y,
      angle: 0,
      length: 40,
      width: 5,
      spread: 0,
      color: phase === 3 ? PALETTE.cyan : PALETTE.red,
      life: 0.5,
      maxLife: 0.5,
      grow: 8,
    });
    bus.emit('sfx', 'emp');
    bus.emit(EV.banner, { text: `0xDEAD · PHASE ${phase}`, sub: subs[phase - 1] ?? '', ms: 1200 });
  }

  private updateBossSummons(e: Enemy, dt: number, phase: number): void {
    e.summonAt -= dt;
    const queued = e.summonQueue ?? 0;
    if (queued > 0) {
      if (e.summonAt > 0) return;
      e.summonQueue = queued - 1;
      e.summonAt = e.summonQueue > 0 ? BOSS.summon.volleyGap : BOSS.summon.every;
      this.releaseMinions(e, e.summonSize ?? BOSS.summon.perVolley, phase);
      return;
    }
    if (phase < 2 || e.summonAt > 0) return;
    if (phase === 2) {
      e.summonAt = BOSS.summon.every;
      e.summonSize = BOSS.summon.perVolley;
      e.summonQueue = BOSS.summon.volleys - 1;
      this.releaseMinions(e, BOSS.summon.perVolley, phase);
      return;
    }
    e.summonAt = BOSS.summon.heavyEvery;
    e.summonSize = BOSS.summon.heavyPerVolley;
    e.summonQueue = BOSS.summon.heavyVolleys - 1;
    this.releaseMinions(e, BOSS.summon.heavyPerVolley, phase);
  }

  private releaseMinions(e: Enemy, count: number, phase: number): void {
    const pool = bossSummonPool(this.run.time, phase);
    const towardPlayer = Math.atan2(this.playerY - e.y, this.playerX - e.x);
    for (let i = 0; i < count; i++) {
      const angle = towardPlayer + this.rng.range(-BOSS.summon.spawnFan, BOSS.summon.spawnFan);
      const r = this.rng.range(BOSS.summon.spawnNearGap, BOSS.summon.spawnNearSpread);
      const minion = this.spawnEnemy(this.rng.pick(pool), e.x + Math.cos(angle) * r, e.y + Math.sin(angle) * r, true);
      if (minion) minion.summoned = true;
    }
    for (let i = 0; i < 10; i++) {
      const angle = towardPlayer + this.rng.range(-BOSS.summon.spawnFan, BOSS.summon.spawnFan);
      const r = this.rng.range(40, BOSS.summon.spawnNearSpread);
      this.fx.burst(e.x + Math.cos(angle) * r, e.y + Math.sin(angle) * r, PALETTE.orange, 3, 150, 0.5, 0.6);
    }
    bus.emit('sfx', 'explode');
  }

  private bossBarrage(
    e: Enemy,
    dt: number,
    dist: number,
    profile: { every: number; bullets: number; speed: number; damage: number },
  ): void {
    e.castAt -= dt;
    if (e.castAt > 0 || dist > BOSS.range) return;
    const bullets = profile.bullets;
    const speed = profile.speed;
    const damage = profile.damage;
    e.castAt = profile.every;
    const offset = this.rng.range(0, TAU);
    for (let i = 0; i < bullets; i++) {
      this.spawnBossBullet(e, offset + (i / bullets) * TAU, speed, damage, PALETTE.red);
    }
    this.fx.burst(e.x, e.y, PALETTE.red, 12, 240, 0.5, 0.9);
  }

  private bossSpiral(e: Enemy, dt: number, dist: number): void {
    const shots = e.spiralShots ?? 0;
    if (shots > 0) {
      e.spiralAt = (e.spiralAt ?? 0) - dt;
      if (e.spiralAt > 0) return;
      e.spiralAt = BOSS.spiral.every;
      e.spiralShots = shots - 1;
      e.spiralAngle = (e.spiralAngle ?? 0) + BOSS.spiral.turn;
      for (let arm = 0; arm < BOSS.spiral.arms; arm++) {
        this.spawnBossBullet(
          e,
          e.spiralAngle + (arm / BOSS.spiral.arms) * TAU,
          BOSS.spiral.speed,
          BOSS.spiral.damage,
          PALETTE.cyan,
        );
      }
      return;
    }
    e.castAt -= dt;
    if (e.castAt > 0 || dist > BOSS.range) return;
    e.castAt = BOSS.spiral.ringEvery;
    if (this.rng.chance(BOSS.spiral.chance)) {
      e.spiralShots = BOSS.spiral.shots;
      e.spiralAt = 0;
      e.spiralAngle = this.rng.range(0, TAU);
      this.fx.burst(e.x, e.y, PALETTE.cyan, 20, 320, 0.6, 1);
      this.cameras.main.shake(220, 0.007);
      bus.emit('sfx', 'emp');
      return;
    }
    const offset = this.rng.range(0, TAU);
    for (let i = 0; i < BOSS.ring.bullets; i++) {
      const angle = offset + (i / BOSS.ring.bullets) * TAU;
      this.spawnBossBullet(e, angle, BOSS.ring.speedFast, BOSS.ring.damage, PALETTE.red);
      this.spawnBossBullet(e, angle, BOSS.ring.speedSlow, BOSS.ring.damage, PALETTE.purple);
    }
    this.fx.burst(e.x, e.y, PALETTE.purple, 18, 300, 0.55, 0.95);
  }

  private throwerVolley(e: Enemy): void {
    const base = Math.atan2(this.playerY - e.y, this.playerX - e.x);
    const buff = (e.empoweredUntil ?? 0) > this.run.time ? DAEMON.damage : 1;
    const damage = THROWER.damage * buff * enemyDamageScale(this.run.time);
    for (let i = 0; i < THROWER.bullets; i++) {
      const angle = base + (i - (THROWER.bullets - 1) / 2) * THROWER.spread;
      this.spawnProjectile({
        x: e.x,
        y: e.y,
        vx: Math.cos(angle) * THROWER.speed,
        vy: Math.sin(angle) * THROWER.speed,
        damage,
        radius: 10,
        life: 5,
        pierce: 0,
        hostile: true,
        color: PALETTE.yellow,
        texture: 'proj_bullet',
        fuse: 0,
        blast: 0,
      });
    }
    this.fx.burst(e.x, e.y, PALETTE.yellow, 6, 150, 0.35, 0.6);
    bus.emit('sfx', 'shoot');
  }

  private spawnBossBullet(e: Enemy, angle: number, speed: number, damage: number, color: number): void {
    this.spawnProjectile({
      x: e.x,
      y: e.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: damage * enemyDamageScale(this.run.time),
      radius: 11,
      life: 7,
      pierce: 0,
      hostile: true,
      color,
      texture: 'proj_bullet',
      fuse: 0,
      blast: 0,
    });
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
      this.weaponTimers.set(
        id,
        def.cooldown(level) *
          stats.cooldownMult *
          this.zoneMods.cooldown *
          this.cacheCooldownMult() *
          this.eventCooldownMult(),
      );
      this.fireWeapon(id, level);
    }
  }

  private pickTargetsAround(
    x: number,
    y: number,
    range: number,
    exclude?: Set<number>,
    preferAngle?: number,
  ): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = range * range;
    const list = this.grid.query(x, y, range, this.scratch2);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead || exclude?.has(e.id)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d = dx * dx + dy * dy;
      const bias = e.boss ? 0.25 : 1;
      let score = d * bias;
      if (preferAngle !== undefined) {
        const worldAngle = Math.atan2(e.y - this.playerY, e.x - this.playerX);
        let diff = Math.abs(worldAngle - preferAngle) % TAU;
        if (diff > Math.PI) diff = TAU - diff;
        score *= 0.35 + diff / Math.PI;
      }
      if (score < bestScore) {
        bestScore = score;
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
      this.registerFocusTarget(targets[0]?.id ?? null);
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
          weapon: 'dart',
          bounces: this.run.evolutions.dart === 'dart_bounce' ? DART_BOUNCE.bounces : 0,
        });
      }
      bus.emit('sfx', 'shoot');
      return;
    }

    if (id === 'bomb') {
      const count = bombCount(level) + bonus;
      const targets = this.pickTargets(count, SPAWN.engageRange);
      this.registerFocusTarget(targets[0]?.id ?? null);
      for (let i = 0; i < count; i++) {
        const target = targets[i % Math.max(1, targets.length)];
        const angle = target
          ? Math.atan2(target.y - this.playerY, target.x - this.playerX)
          : this.facing + this.rng.range(-0.4, 0.4);
        const dist = target ? Math.hypot(target.x - this.playerX, target.y - this.playerY) : 240;
        const travel = Phaser.Math.Clamp(dist, 70, SPAWN.engageRange);
        const fuse = travel / 420;
        const hold = this.run.evolutions.bomb === 'bomb_chain' ? BOMB_CHAIN.fuseBonus : 0;
        this.spawnProjectile({
          x: this.playerX,
          y: this.playerY,
          vx: Math.cos(angle) * 420,
          vy: Math.sin(angle) * 420,
          damage: bombDamage(level) * stats.damageMult,
          radius: 13,
          life: fuse + hold,
          pierce: 0,
          hostile: false,
          color: PALETTE.orange,
          texture: 'w_bomb',
          fuse: fuse + hold,
          blast: bombBlast(level),
          hold,
          weapon: 'bomb',
        });
      }
      bus.emit('sfx', 'shoot');
      return;
    }

    if (id === 'ray') {
      const count = rayCount(level) + bonus;
      const targets = this.pickTargets(count, SPAWN.engageRange);
      this.registerFocusTarget(targets[0]?.id ?? null);
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
      this.registerFocusTarget(target?.id ?? null);
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
        this.damageEnemy(e, damage, true, cos * 90, sin * 90, true, 'ray');
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
      this.damageEnemy(e, damage, true, cos * 120, sin * 120, true, 'cone');
    }
  }

  private syncOrbiters(level: number, dt: number): void {
    const count = orbitCount(level);
    const evolution = this.run.evolutions.orbit;
    const radiusScale =
      evolution === 'orbit_wide' ? ORBIT_WIDE.radius : evolution === 'orbit_reflect' ? ORBIT_REFLECT.radius : 1;
    const knockback = evolution === 'orbit_wide' ? ORBIT_WIDE.knockback : 1;
    while (this.orbiters.length > count) {
      const o = this.orbiters.pop()!;
      if (o.sprite) this.images.release(o.sprite);
    }
    this.orbitPhase =
      (this.orbitPhase +
        orbitSpin(level) * this.cacheSpeedMult() * this.eventAttackSpeedMult() * dt) %
      TAU;
    const slots = ringSlotAngles(count, this.orbitPhase);
    while (this.orbiters.length < count) {
      const slot = this.orbiters.length;
      const sprite = this.images.acquire();
      sprite.setTexture('w_orbit');
      sprite.setTint(WEAPON_DEFS.orbit.color);
      sprite.setDepth(DEPTH.orbiter);
      this.orbiters.push({
        index: this.orbiterSeq++ % MAX_ORBIT_SLOTS,
        angle: slots[slot],
        radius: orbitRadius(level) * radiusScale,
        damage: orbitDamage(level),
        x: this.playerX,
        y: this.playerY,
        sprite,
      });
    }
    const radius = orbitRadius(level) * radiusScale;
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
        this.damageEnemy(
          e,
          o.damage,
          false,
          (dx / d) * 130 * knockback,
          (dy / d) * 130 * knockback,
          true,
          'orbit',
        );
      }
      this.reflectAt(o.x, o.y);
    }
  }

  private reflectAt(x: number, y: number): void {
    const evolved = this.run.evolutions.orbit === 'orbit_reflect';
    const reflectRadius = evolved ? ORBIT_REFLECT.reflectRadius : SHIELD.reflectRadius;
    const reach = reflectRadius * reflectRadius;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (p.dead || !p.hostile) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const distance = Math.hypot(dx, dy);
      if (dx * dx + dy * dy > reach) continue;
      const reflected = reflectBullet(
        distance,
        p,
        evolved
          ? {
              radius: ORBIT_REFLECT.reflectRadius,
              damageScale: ORBIT_REFLECT.damageScale,
              speedScale: ORBIT_REFLECT.speedScale,
            }
          : undefined,
      );
      if (!reflected) continue;
      p.vx = reflected.vx;
      p.vy = reflected.vy;
      p.damage = reflected.damage;
      p.hostile = false;
      p.weapon = 'orbit';
      p.color = PALETTE.green;
      p.life = Math.max(p.life, SHIELD.reflectMinLife);
      if (p.sprite) p.sprite.setTint(PALETTE.green);
      this.fx.burst(p.x, p.y, PALETTE.green, 4, 170, 0.3, 0.5);
      bus.emit('sfx', 'hit');
    }
  }

  private syncClones(level: number, dt: number): void {
    const count = cloneCount(level);
    while (this.clones.length > count) {
      const c = this.clones.pop()!;
      if (c.sprite) this.images.release(c.sprite);
    }
    this.clonePhase = (this.clonePhase + CLONE_SPIN * dt) % TAU;
    const slots = ringSlotAngles(count, this.clonePhase);
    while (this.clones.length < count) {
      const slot = this.clones.length;
      const sprite = this.images.acquire();
      sprite.setTexture('w_clone');
      sprite.setDepth(DEPTH.clone);
      sprite.setTint(PALETTE.purple);
      this.clones.push({
        angle: slots[slot],
        distance: CLONE_DISTANCE,
        x: this.playerX,
        y: this.playerY,
        fireAt: 0.4,
        damage: cloneDamage(level),
        sprite,
      });
    }
    const damage = cloneDamage(level) * this.run.stats.damageMult;
    const evolution = this.run.evolutions.clone;
    const focus = evolution === 'clone_focus';
    const spread = evolution === 'clone_spread';
    const focusTarget = focus
      ? this.pickTargetsAround(this.playerX, this.playerY, SPAWN.engageRange * CLONE_FOCUS.rangeScale)
      : null;
    const taken = spread ? new Set<number>() : null;
    const spreadRange = SPAWN.engageRange * CLONE_SPREAD.rangeScale;
    for (let i = 0; i < this.clones.length; i++) {
      const c = this.clones[i];
      c.damage = damage;
      let drift = slots[i] - c.angle;
      while (drift > Math.PI) drift -= TAU;
      while (drift < -Math.PI) drift += TAU;
      c.angle += drift * Math.min(1, dt * 8);
      c.x = this.playerX + Math.cos(c.angle) * c.distance;
      c.y = this.playerY + Math.sin(c.angle) * c.distance;
      if (c.sprite) {
        c.sprite.setPosition(c.x, c.y);
        c.sprite.setAlpha(0.55 + 0.45 * Math.sin(this.run.time * 6 + i));
      }
      c.fireAt -= dt;
      if (c.fireAt <= 0) {
        c.fireAt =
          cloneCooldown(level) *
          this.run.stats.cooldownMult *
          this.zoneMods.cooldown *
          this.cacheCooldownMult() *
          this.eventCooldownMult();
        let target: Enemy | null;
        if (focus) {
          target = focusTarget && !focusTarget.dead ? focusTarget : null;
        } else if (spread) {
          target = this.pickTargetsAround(c.x, c.y, spreadRange, taken ?? undefined, c.angle);
          if (!target) target = this.pickTargetsAround(c.x, c.y, spreadRange);
          if (target && taken) taken.add(target.id);
        } else {
          target = this.pickTargetsAround(c.x, c.y, SPAWN.engageRange);
        }
        if (!target) continue;
        this.registerFocusTarget(target.id);
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
          weapon: 'clone',
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
      const holding = (p.hold ?? 0) > 0 && p.life <= (p.hold ?? 0);
      if (!holding) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      p.trailAt -= dt;
      if (p.sprite) {
        p.sprite.setPosition(p.x, p.y);
        p.sprite.setRotation(holding ? this.run.time * 8 : Math.atan2(p.vy, p.vx));
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
        let damage = p.damage;
        if (p.weapon === 'dart' && this.run.evolutions.dart === 'dart_stack') {
          if (this.dartFocusId === e.id && this.run.time - this.dartFocusAt <= DART_FOCUS.window) {
            this.dartStacks = Math.min(DART_FOCUS.maxStacks, this.dartStacks + 1);
          } else {
            this.dartFocusId = e.id;
            this.dartStacks = 0;
          }
          this.dartFocusAt = this.run.time;
          damage *= 1 + this.dartStacks * DART_FOCUS.perHit;
        }
        this.damageEnemy(e, damage, p.blast > 0, (p.vx / len) * 110, (p.vy / len) * 110, true, p.weapon);
        if (p.blast > 0) {
          this.explode(p);
          p.dead = true;
          break;
        }
        if (
          p.weapon === 'dart' &&
          this.run.evolutions.dart === 'dart_bounce' &&
          (p.bounces ?? 0) > 0 &&
          this.bounceDart(p, e)
        ) {
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

  private bounceDart(p: Projectile, from: Enemy): boolean {
    let best: Enemy | null = null;
    let bestDist = DART_BOUNCE.radius * DART_BOUNCE.radius;
    const list = this.grid.query(from.x, from.y, DART_BOUNCE.radius, this.scratch2);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead || e.id === from.id || p.hit.has(e.id)) continue;
      const dx = e.x - from.x;
      const dy = e.y - from.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    if (!best) return false;
    const angle = Math.atan2(best.y - from.y, best.x - from.x);
    const speed = Math.hypot(p.vx, p.vy) || 1;
    p.bounces = (p.bounces ?? 1) - 1;
    p.damage *= DART_BOUNCE.scale;
    p.x = from.x;
    p.y = from.y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.life = Math.max(p.life, 0.8);
    this.fx.burst(from.x, from.y, PALETTE.cyan, 5, 150, 0.3, 0.5);
    return true;
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
        weapon: p.weapon,
        bounces: 0,
      });
    }
    this.fx.text(p.x, p.y - 12, '|⟩', '#ffffff', 12);
  }

  private damageBlast(
    x: number,
    y: number,
    radius: number,
    damage: number,
    source?: WeaponId,
  ): number {
    const list = this.grid.query(x, y, radius, this.scratch2);
    let hits = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius + e.radius) continue;
      const falloff = Phaser.Math.Clamp(1 - dist / (radius + e.radius), 0.45, 1);
      this.damageEnemy(
        e,
        damage * falloff,
        false,
        (dx / (dist || 1)) * 200,
        (dy / (dist || 1)) * 200,
        true,
        source,
      );
      hits++;
    }
    return hits;
  }

  private explode(p: Projectile): void {
    const hits = this.damageBlast(p.x, p.y, p.blast, p.damage, 'bomb');
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
    if (this.run.evolutions.bomb === 'bomb_burn') {
      this.addBurnPatch(p.x, p.y, p.blast, p.damage);
    } else if (this.run.evolutions.bomb === 'bomb_chain') {
      this.scheduleChain(p.x, p.y, p.blast, p.damage, BOMB_CHAIN.depth);
    }
  }

  private addBurnPatch(x: number, y: number, blast: number, damage: number): void {
    const now = this.run.time;
    this.burnPatches.push({
      x,
      y,
      radius: blast * BOMB_BURN.radiusScale,
      damage: damage * BOMB_BURN.dpsScale * BOMB_BURN.tick,
      until: now + BOMB_BURN.duration,
      nextTick: now + BOMB_BURN.tick,
      fxAt: now,
    });
    if (this.burnPatches.length > 12) this.burnPatches.shift();
  }

  private updateBurn(): void {
    for (let i = this.burnPatches.length - 1; i >= 0; i--) {
      const patch = this.burnPatches[i];
      if (this.run.time >= patch.until) {
        const last = this.burnPatches.pop()!;
        if (i < this.burnPatches.length) this.burnPatches[i] = last;
        continue;
      }
      while (this.run.time >= patch.nextTick) {
        patch.nextTick += BOMB_BURN.tick;
        const list = this.grid.query(patch.x, patch.y, patch.radius, this.scratch2);
        for (let k = 0; k < list.length; k++) {
          const e = list[k];
          if (e.dead) continue;
          if (Math.hypot(e.x - patch.x, e.y - patch.y) > patch.radius + e.radius) continue;
          this.damageEnemy(e, patch.damage, false, 0, 0, true, 'bomb');
        }
      }
      if (this.run.time >= patch.fxAt) {
        patch.fxAt += 0.18;
        const angle = this.rng.range(0, TAU);
        const r = this.rng.range(0, patch.radius * 0.7);
        this.fx.burst(
          patch.x + Math.cos(angle) * r,
          patch.y + Math.sin(angle) * r,
          PALETTE.orange,
          2,
          70,
          0.35,
          0.5,
        );
      }
    }
  }

  private scheduleChain(x: number, y: number, blast: number, damage: number, depth: number): void {
    if (depth <= 0) return;
    const list = this.grid.query(x, y, BOMB_CHAIN.searchRadius, this.scratch2);
    let scheduled = 0;
    for (let i = 0; i < list.length && scheduled < BOMB_CHAIN.count; i++) {
      const e = list[i];
      if (e.dead) continue;
      this.chainBlasts.push({
        x: e.x,
        y: e.y,
        radius: blast * BOMB_CHAIN.radiusScale,
        damage: damage * BOMB_CHAIN.damageScale,
        at: this.run.time + BOMB_CHAIN.delay,
        depth: depth - 1,
      });
      scheduled++;
    }
    if (this.chainBlasts.length > 40) this.chainBlasts.splice(0, this.chainBlasts.length - 40);
  }

  private updateChain(): void {
    for (let i = this.chainBlasts.length - 1; i >= 0; i--) {
      const blast = this.chainBlasts[i];
      if (this.run.time < blast.at) continue;
      const last = this.chainBlasts.pop()!;
      if (i < this.chainBlasts.length) this.chainBlasts[i] = last;
      const hits = this.damageBlast(blast.x, blast.y, blast.radius, blast.damage, 'bomb');
      this.fx.burst(blast.x, blast.y, PALETTE.yellow, 12, 240, 0.45, 0.75);
      this.beams.push({
        kind: 'ring',
        x: blast.x,
        y: blast.y,
        angle: 0,
        length: blast.radius,
        width: 4,
        spread: 0,
        color: PALETTE.yellow,
        life: 0.22,
        maxLife: 0.22,
        grow: 0.12,
      });
      if (hits > 0) bus.emit('sfx', 'explode');
      this.scheduleChain(blast.x, blast.y, blast.radius, blast.damage, blast.depth);
    }
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
    weapon?: WeaponId;
    bounces?: number;
    hold?: number;
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
      weapon: config.weapon,
      bounces: config.bounces,
      hold: config.hold,
      dead: false,
    });
  }

  private dropItem(x: number, y: number): void {
    const kind = pickItemDrop(this.rng.next());
    if (!kind) return;
    const def = ITEM_DEFS[kind];
    const sprite = this.images.acquire();
    sprite.setTexture(`item_${kind}`);
    sprite.setTint(def.color);
    sprite.setDepth(DEPTH.orb);
    sprite.setScale(1.15 * TEX_SCALE);
    sprite.setPosition(x, y);
    const angle = this.rng.range(0, TAU);
    const speed = this.rng.range(40, 110);
    this.pickups.push({
      id: this.pickupId++,
      kind,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: ITEM.lifetime * this.orbLifeScale,
      bob: 0,
      sprite,
      dead: false,
    });
    this.fx.burst(x, y, def.color, 6, 130, 0.4, 0.5);
  }

  private updatePickups(dt: number): void {
    const stats = this.run.stats;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.dead) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.dead = true;
        this.fx.burst(p.x, p.y, ITEM_DEFS[p.kind].color, 4, 90, 0.3, 0.45);
        continue;
      }
      p.bob += dt;
      const dx = this.playerX - p.x;
      const dy = this.playerY - p.y;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = stats.pickupRadius + ITEM.grabRadius;
      if (dist < reach) homeOrbVelocity(p, dx, dy, dist, stats.speed, dt);
      else dampOrbVelocity(p, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.sprite) {
        p.sprite.setPosition(p.x, p.y);
        const pulse = 1 + 0.12 * Math.sin(p.bob * 5);
        p.sprite.setScale(pulse * 1.15 * TEX_SCALE);
        const fading = p.life < ITEM.blinkTime;
        p.sprite.setAlpha(
          fading ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.run.time * 16)) : 1,
        );
      }
      const restX = this.playerX - p.x;
      const restY = this.playerY - p.y;
      if (restX * restX + restY * restY <= (PLAYER.collectRadius + ITEM.grabRadius) ** 2) {
        p.dead = true;
        this.collectItem(p.kind);
      }
    }
  }

  private collectItem(kind: ItemId): void {
    const def = ITEM_DEFS[kind];
    this.fx.burst(this.playerX, this.playerY, def.color, 20, 300, 0.6, 0.9);
    this.cameras.main.flash(160, ...this.flashTint(def.color), false);
    if (kind === 'hotfix') {
      const before = this.run.hp;
      this.run.hp = Math.min(this.run.stats.maxHp, this.run.hp + ITEM.heal);
      const healed = Math.round(this.run.hp - before);
      this.fx.text(this.playerX, this.playerY - 46, `+${healed} HP`, '#4aa8ff', 18);
      bus.emit(EV.banner, { text: 'HOTFIX APPLIED', sub: `patched +${healed} hp`, ms: 1200 });
      bus.emit('sfx', 'levelup');
      return;
    }
    if (kind === 'sigkill') {
      this.empBlast();
      return;
    }
    const gained = this.fetchAllOrbs();
    this.fx.text(this.playerX, this.playerY - 46, `+${Math.round(gained)} XP`, '#bd5fff', 18);
    bus.emit(EV.banner, {
      text: 'FETCH ALL',
      sub: gained > 0 ? `pulled ${Math.round(gained)} xp back in` : 'nothing left to pull',
      ms: 1300,
    });
    bus.emit('sfx', 'levelup');
  }

  private flashTint(color: number): [number, number, number] {
    return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
  }

  private empBlast(): void {
    let wiped = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead || e.boss) continue;
      wiped += 1;
      this.killEnemy(e);
    }
    const boss = this.activeBoss;
    if (boss && !boss.dead) {
      this.damageEnemy(boss, boss.maxHp * ITEM.empBossPct, true);
    }
    this.cameras.main.shake(420, 0.016);
    hud.damageFlash = 1;
    this.beams.push({
      kind: 'ring',
      x: this.playerX,
      y: this.playerY,
      angle: 0,
      length: 40,
      width: 7,
      spread: 0,
      color: PALETTE.orange,
      life: 0.6,
      maxLife: 0.6,
      grow: 10,
    });
    bus.emit('sfx', 'emp');
    bus.emit(EV.banner, {
      text: 'SIGKILL',
      sub: `${wiped} process${wiped === 1 ? '' : 'es'} terminated`,
      ms: 1500,
    });
  }

  private fetchAllOrbs(): number {
    let gained = 0;
    let count = 0;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (o.dead) continue;
      o.dead = true;
      gained += o.value;
      count += 1;
      this.fx.burst(o.x, o.y, o.big ? PALETTE.cyan : PALETTE.green, 2, 110, 0.3, 0.4);
    }
    this.run.xp += gained;
    this.registerXpPickup(count);
    return gained;
  }

  private updateOrbs(dt: number): void {
    const stats = this.run.stats;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (o.dead) continue;
      o.life -= dt;
      if (o.life <= 0) {
        o.dead = true;
        this.fx.burst(o.x, o.y, o.big ? PALETTE.cyan : PALETTE.green, 3, 70, 0.3, 0.4);
        continue;
      }
      const dx = this.playerX - o.x;
      const dy = this.playerY - o.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < stats.pickupRadius) {
        homeOrbVelocity(o, dx, dy, dist, stats.speed, dt);
      } else {
        dampOrbVelocity(o, dt);
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.sprite) {
        o.sprite.setPosition(o.x, o.y);
        const pulse = 1 + 0.12 * Math.sin(this.run.time * 6 + o.value);
        const fading = o.life < ORB.blinkTime;
        const dim = fading ? 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.run.time * 16 + o.value)) : 1;
        const shrink = fading ? 0.85 + 0.15 * (o.life / ORB.blinkTime) : 1;
        o.sprite.setScale(pulse * shrink * (o.big ? 1.35 : 1) * TEX_SCALE);
        o.sprite.setAlpha(dim);
      }
      const restX = this.playerX - o.x;
      const restY = this.playerY - o.y;
      if (restX * restX + restY * restY <= PLAYER.collectRadius * PLAYER.collectRadius) {
        o.dead = true;
        this.run.xp += o.value;
        this.registerXpPickup(1);
        bus.emit('sfx', 'pickup');
        this.fx.burst(o.x, o.y, PALETTE.green, o.big ? 8 : 3, 110, 0.3, 0.45);
      }
    }
  }

  private dropOrbs(x: number, y: number, value: number, bossDrop: boolean): void {
    const count = bossDrop ? 6 : this.rng.int(1, 3);
    const per = Math.max(0.5, (value * SPAWN.xpValueScale) / count);
    for (let i = 0; i < count; i++) {
      const tier = orbTier(bossDrop, this.rng.next());
      const angle = this.rng.range(0, TAU);
      const speed = this.rng.range(40, 115);
      const sprite = this.images.acquire();
      sprite.setTexture(this.rng.chance(0.5) ? 'orb_0' : 'orb_1');
      sprite.setTint(tier.big ? PALETTE.cyan : PALETTE.green);
      sprite.setDepth(DEPTH.orb);
      sprite.setScale((tier.big ? 1.35 : 1) * TEX_SCALE);
      sprite.setPosition(x, y);
      this.orbs.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        value: per * tier.multiplier,
        big: tier.big,
        life: (tier.big ? ORB.bigLifetime : ORB.lifetime) * this.orbLifeScale,
        sprite,
        dead: false,
      });
    }
  }

  private damageEnemy(
    e: Enemy,
    amount: number,
    showText: boolean,
    knockX = 0,
    knockY = 0,
    dropLoot = true,
    source?: WeaponId,
  ): void {
    if (e.dead) return;
    const crit = this.rng.chance(0.1);
    let dmg = amount * (crit ? 2 : 1);
    if (source) {
      const parallel = this.run.passives.parallel ?? 0;
      if (parallel > 0 && e.lastWeapon && e.lastWeapon !== source) {
        dmg *= 1 + PARALLEL_PASSIVE.bonus(parallel);
        hud.parallelHits += 1;
        if (this.run.time - this.parallelFxAt >= 0.12) {
          this.parallelFxAt = this.run.time;
          this.fx.text(e.x, e.y - e.radius - 10, '||', '#ffa500', 12);
        }
      }
      e.lastWeapon = source;
    }
    e.hp -= dmg;
    e.hitAt = this.run.time;
    if (knockX !== 0 || knockY !== 0) {
      const resist = e.boss ? 0.06 : e.type === 'stack' ? 0.25 : 1;
      e.knockX += knockX * resist;
      e.knockY += knockY * resist;
    }
    if (e.hp <= 0) {
      this.killEnemy(e, dropLoot);
      return;
    }
    if (showText || crit) this.fx.damageText(e.x, e.y - e.radius - 6, dmg, crit);
    this.fx.sparks(e.x, e.y, e.color, crit ? 4 : 2);
  }

  private killEnemy(e: Enemy, dropLoot = true): void {
    if (e.dead) return;
    e.dead = true;
    if (this.dartFocusId === e.id) {
      this.dartFocusId = 0;
      this.dartStacks = 0;
      this.dartFocusAt = -10;
    }
    if (e.challenge && this.activeCommit && !this.activeCommit.done) {
      this.activeCommit.kills += 1;
      if (this.activeCommit.kills >= this.activeCommit.need) {
        this.completeCommit(this.activeCommit);
      }
    }
    this.run.kills += 1;
    const def = ENEMY_DEFS[e.type];
    this.fx.burst(e.x, e.y, e.color, e.boss ? 44 : e.elite ? 14 : 8, e.boss ? 380 : 200, 0.6, e.boss ? 1.3 : 0.75);
    if (dropLoot && !e.summoned) {
      this.dropOrbs(e.x, e.y, e.xp, e.boss);
      this.dropItem(e.x, e.y);
    }
    bus.emit('sfx', e.boss ? 'explode' : 'hit');
    if (e.boss) {
      this.activeBoss = null;
      hud.boss = null;
      this.cameras.main.shake(500, 0.012);
      bus.emit(EV.banner, { text: 'CORE DUMPED', sub: `${def.name} terminated`, ms: 1600 });
      this.pendingRewards = rollBossRewards(this.run, this.rng, this.pendingEvolutions);
      this.choosing = true;
      this.chooseTimer = 0.8;
      hud.choices = this.pendingChoiceCount();
    }
  }

  private updateSpawner(dt: number): void {
    const time = this.run.time;
    const bossAlive = this.activeBoss !== null;
    if (time >= this.nextBossAt) {
      if (this.activeEvent && !this.activeEvent.done) return;
      this.nextBossAt = time + SPAWN.bossEvery;
      if (!bossAlive) this.spawnBoss();
    }
    if (bossAlive) {
      this.spawnTimer = 0;
      return;
    }
    if (this.enemies.length >= SPAWN.maxEnemies) {
      this.spawnTimer = 0;
      return;
    }
    const rate = spawnRate(time);
    this.spawnTimer += rate * dt;
    let budget = SPAWN.maxPerFrame;
    while (this.spawnTimer >= 1 && budget > 0) {
      this.spawnTimer -= 1;
      budget -= 1;
      const spawned = this.spawnEnemy();
      if (spawned && spawned.type === 'deadlock' && this.rng.chance(0.7)) {
        const x = Phaser.Math.Clamp(spawned.x + this.rng.range(-100, 100), 40, WORLD.width - 40);
        const y = Phaser.Math.Clamp(spawned.y + this.rng.range(-100, 100), 40, WORLD.height - 40);
        this.spawnEnemy('deadlock', x, y, true);
      }
    }
    if (this.spawnTimer > SPAWN.maxPerFrame) this.spawnTimer = 0;
  }

  private spawnEnemy(type?: EnemyTypeId, x?: number, y?: number, forceNormal = false): Enemy | null {
    const time = this.run.time;
    const id = type ?? this.pickSpawnType();
    if (this.isTypeCapped(id)) return null;
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
      damage: def.damage * (elite ? 1.35 : 1) * enemyDamageScale(time),
      xp: Math.round(def.xp * (elite ? 3 : 1)),
      color: def.color,
      glyph: def.glyph,
      boss: false,
      elite,
      summoned: false,
      phasing: def.phasing,
      dead: false,
      sprite,
      hitAt: -10,
      touchAt: 0,
      castAt: 3,
      summonAt: 6,
      growT: 0,
      orbitHit: new Array<number>(MAX_ORBIT_SLOTS).fill(-10),
      knockX: this.rng.range(-10, 10),
      knockY: this.rng.range(-10, 10),
    };
    if (id === 'breakpoint') enemy.castAt = BREAKPOINT.castFirst;
    if (id === 'deadlock') enemy.castAt = this.rng.range(1.5, 3.5);
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
    const pos = this.ringPosition(18);
    if (!pos) return;
    this.bossGeneration += 1;
    const scale = (1 + (this.bossGeneration - 1) * 0.65) * (1 + time / 600);
    const hp = def.hp * scale * this.readQaBossHp();
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
      summoned: false,
      phasing: false,
      dead: false,
      sprite,
      hitAt: -10,
      touchAt: 0,
      castAt: 1.4,
      summonAt: 4.5,
      growT: 0,
      orbitHit: new Array<number>(MAX_ORBIT_SLOTS).fill(-10),
      knockX: 0,
      knockY: 0,
    };
    this.enemies.push(boss);
    this.activeBoss = boss;
    hud.boss = { name: def.name, hp, maxHp: hp, phase: 1 };
    this.beginBossEntrance(boss, pos.x, pos.y, def.color);
  }

  private beginBossEntrance(boss: Enemy, x: number, y: number, color: number): void {
    this.burnPatches = [];
    this.chainBlasts = [];
    this.deadlockLinks = [];
    this.breakpointMarks = [];
    const event = this.activeEvent;
    if (event && !event.done && event.engaged) {
      event.done = true;
      if (this.activeCommit === event) this.activeCommit = null;
    }
    const sprite = boss.sprite;
    if (sprite) {
      sprite.setAlpha(0);
      sprite.setScale(0.2 * TEX_SCALE);
    }
    let waveMax = ENTRANCE.waveFloor;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (o.dead) continue;
      waveMax = Math.max(waveMax, Math.hypot(o.x - x, o.y - y) + 80);
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead || e.boss) continue;
      waveMax = Math.max(waveMax, Math.hypot(e.x - x, e.y - y) + 80);
    }
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.pan(x, y, ENTRANCE.panMs, 'Sine.easeInOut');
    this.entrance = {
      x,
      y,
      color,
      sprite,
      t: 0,
      materialised: false,
      waveActive: false,
      waveDone: false,
      waveRadius: 0,
      waveMax: Math.min(waveMax, ENTRANCE.waveCeil),
      ringAt: 0,
      holdAt: 0,
      returning: false,
      returnEnd: 0,
    };
    bus.emit(EV.banner, {
      text: 'FATAL: SEGFAULT',
      sub: '0xDEAD is booting · binary field will be purged',
      ms: 3000,
    });
  }

  private updateEntrance(dt: number): void {
    const e = this.entrance;
    if (!e) return;
    e.t += dt * 1000;

    if (!e.materialised && e.t >= ENTRANCE.panMs) {
      e.materialised = true;
      if (e.sprite) {
        this.tweens.add({
          targets: e.sprite,
          scale: TEX_SCALE,
          alpha: 1,
          duration: 220,
          ease: 'Back.out',
        });
      }
      const cam = this.cameras.main;
      cam.flash(170, 255, 0, 64, false);
      cam.shake(520, 0.015);
      hud.damageFlash = 1;
      this.fx.burst(e.x, e.y, e.color, 30, 460, 0.85, 1.1);
      this.fx.burst(e.x, e.y, PALETTE.white, 14, 260, 0.6, 0.9);
      bus.emit('sfx', 'boss');
    }

    if (e.materialised && !e.waveActive && !e.waveDone && e.t >= ENTRANCE.panMs + ENTRANCE.chargeMs) {
      e.waveActive = true;
      e.waveRadius = 0;
      e.ringAt = 0;
      hud.damageFlash = 1;
      bus.emit('sfx', 'emp');
    }

    if (e.waveActive) {
      e.waveRadius += ENTRANCE.waveSpeed * dt;
      this.purgeLootWithin(e.x, e.y, e.waveRadius);
      this.purgeEnemiesWithin(e.x, e.y, e.waveRadius);
      e.ringAt -= dt * 1000;
      if (e.ringAt <= 0) {
        e.ringAt = ENTRANCE.ringEveryMs;
        this.beams.push({
          kind: 'ring',
          x: e.x,
          y: e.y,
          angle: 0,
          length: e.waveRadius,
          width: 4,
          spread: 0,
          color: PALETTE.cyan,
          life: 0.32,
          maxLife: 0.32,
          grow: 0.12,
        });
      }
      if (e.waveRadius >= e.waveMax) {
        e.waveActive = false;
        e.waveDone = true;
        this.purgeLootWithin(e.x, e.y, Number.POSITIVE_INFINITY);
        this.purgeEnemiesWithin(e.x, e.y, Number.POSITIVE_INFINITY);
        e.holdAt = e.t;
        e.returnEnd = e.t + ENTRANCE.holdMs + ENTRANCE.returnMs;
        this.fx.burst(e.x, e.y, PALETTE.cyan, 22, 320, 0.6, 0.9);
        bus.emit(EV.banner, { text: 'FIELD PURGED', sub: 'binary wiped · back to the fight', ms: 1100 });
      }
    }

    if (e.waveDone && !e.returning && e.t >= e.holdAt + ENTRANCE.holdMs) {
      e.returning = true;
      this.cameras.main.pan(this.playerX, this.playerY, ENTRANCE.returnMs, 'Sine.easeInOut');
    }

    if (e.returning && e.t >= e.returnEnd) {
      this.cameras.main.startFollow(this.playerSprite, true, 0.12, 0.12);
      this.entrance = null;
    }
  }

  private purgeEnemiesWithin(x: number, y: number, radius: number): void {
    const r2 = radius * radius;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead || e.boss) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      e.dead = true;
      this.fx.burst(e.x, e.y, e.color, 6, 210, 0.5, 0.7);
    }
  }

  private purgeLootWithin(x: number, y: number, radius: number): void {
    const r2 = radius * radius;
    let purged = false;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      if (o.dead) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy > r2) continue;
      o.dead = true;
      purged = true;
      this.fx.burst(o.x, o.y, o.big ? PALETTE.cyan : PALETTE.green, 3, 110, 0.3, 0.45);
    }
    if (purged) hud.orbs = this.orbs.length > 0 ? this.orbs.length : 0;
  }

  private ringPosition(pad = SPAWN.ringPadding): { x: number; y: number } | null {
    const cam = this.cameras.main;
    const halfW = viewWidth(cam) / 2 + pad;
    const halfH = viewHeight(cam) / 2 + pad;
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
      } else if (b.kind === 'ring') {
        const radius = b.length * (1 + (b.grow ?? 0) * (1 - t));
        g.lineStyle(Math.max(1, b.width * t), b.color, 0.9 * t);
        g.strokeCircle(b.x, b.y, radius);
        g.lineStyle(Math.max(1, b.width * 0.4 * t), PALETTE.white, 0.55 * t);
        g.strokeCircle(b.x, b.y, radius * 0.985);
      } else {
        const points: Phaser.Geom.Point[] = [new Phaser.Geom.Point(b.x, b.y)];
        const steps = Math.max(6, Math.ceil((b.spread / TAU) * 26));
        const radius = b.length * (1 + (b.grow ?? 0) * (1 - t));
        for (let i = 0; i <= steps; i++) {
          const a = b.angle - b.spread / 2 + (b.spread * i) / steps;
          points.push(new Phaser.Geom.Point(b.x + Math.cos(a) * radius, b.y + Math.sin(a) * radius));
        }
        g.fillStyle(b.color, 0.28 * t);
        g.fillPoints(points, true);
        g.lineStyle(2, b.color, 0.6 * t);
        g.strokePoints(points, true);
      }
    }
    this.drawDeadlockLinks(this.run.time);
  }

  private drawDeadlockLinks(time: number): void {
    const g = this.beamGraphics;
    for (const link of this.deadlockLinks) {
      const a = this.findEnemy(link.aId);
      const b = this.findEnemy(link.bId);
      if (!a || !b) continue;
      const armed = time >= link.armAt;
      const alpha = armed ? 0.85 : 0.3 + 0.2 * Math.abs(Math.sin(time * 18));
      g.lineStyle(armed ? 5 : 2, PALETTE.cyan, alpha);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.strokePath();
      if (armed) {
        g.lineStyle(1.5, PALETTE.white, 0.7);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.strokePath();
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
    if (this.pendingChoiceCount() > 0 && !this.choosing) {
      this.choosing = true;
      hud.choices = this.pendingChoiceCount();
      if (
        this.pendingEvolutions.length === 0 &&
        this.pendingRewards.length === 0 &&
        this.pendingFree === 0
      ) {
        this.openUpgrades('level');
      }
    }
  }

  private pendingChoiceCount(): number {
    return (
      this.run.pendingLevels +
      this.pendingFree +
      this.pendingEvolutions.length +
      (this.pendingRewards.length > 0 ? 1 : 0)
    );
  }

  private openUpgrades(source: 'level' | 'free'): void {
    const choices = pickChoices(this.run, this.rng, 3);
    if (choices.length === 0) {
      if (source === 'level') this.run.pendingLevels = Math.max(0, this.run.pendingLevels - 1);
      else this.pendingFree = Math.max(0, this.pendingFree - 1);
      this.choosing = this.pendingChoiceCount() > 0;
      hud.choices = this.pendingChoiceCount();
      return;
    }
    this.pendingChoices = choices;
    this.panelSource = source;
    this.choosing = true;
    this.panelOpen = true;
    this.chooseTimer = 0.4;
    hud.panel = source;
    hud.panelCards = choices.length;
    hud.choices = this.pendingChoiceCount();
    this.cameras.main.flash(240, 0, 255, 65, false);
    bus.emit('sfx', 'levelup');
    this.fx.burst(this.playerX, this.playerY, PALETTE.green, 26, 260, 0.8, 0.85);
    bus.emit(EV.levelUp, {
      cards: choices.map((id) => toCard(this.run, id)),
      level: this.run.level,
      pending: this.run.pendingLevels,
      title: source === 'free' ? '▸ compile_bonus.rs — 编译节点奖励' : undefined,
      footer: source === 'free' ? '来自地图事件 · 不占用升级次数 · [1] [2] [3] 选择' : undefined,
    });
  }

  private openEvolution(): void {
    const weapon = this.pendingEvolutions[0];
    const options = weapon ? evolutionsFor(weapon) : [];
    if (!weapon || options.length === 0) {
      this.pendingEvolutions.shift();
      this.choosing = this.pendingChoiceCount() > 0;
      hud.choices = this.pendingChoiceCount();
      return;
    }
    this.pendingEvolutionCards = options;
    this.panelSource = 'evolution';
    this.choosing = true;
    this.panelOpen = true;
    this.chooseTimer = 0.35;
    hud.panel = 'evolution';
    hud.panelCards = options.length;
    hud.choices = this.pendingChoiceCount();
    this.cameras.main.flash(200, ...this.flashTint(WEAPON_DEFS[weapon].color), false);
    bus.emit('sfx', 'levelup');
    bus.emit(EV.levelUp, {
      cards: options.map((id) => toEvolutionCard(id)),
      level: this.run.level,
      pending: 0,
      title: `▸ evolution_available.rs — ${WEAPON_DEFS[weapon].name} · 选择分支`,
      footer: '两个分支本局内不可更改 · 进化不会重置武器等级 · [1] [2] 选择',
    });
  }

  private openBossReward(): void {
    if (this.pendingRewards.length === 0) {
      this.choosing = this.pendingChoiceCount() > 0;
      hud.choices = this.pendingChoiceCount();
      return;
    }
    this.panelSource = 'reward';
    this.choosing = true;
    this.panelOpen = true;
    this.chooseTimer = 0.5;
    hud.panel = 'reward';
    hud.panelCards = this.pendingRewards.length;
    hud.choices = this.pendingChoiceCount();
    this.cameras.main.flash(220, 255, 0, 64, false);
    bus.emit('sfx', 'levelup');
    bus.emit(EV.levelUp, {
      cards: this.pendingRewards.map(toBossRewardCard),
      level: this.run.level,
      pending: 0,
      title: '▸ core_dump_reward.rs — BOSS 三选一',
      footer: '奖励立即生效 · 按当前构筑挑选 · [1] [2] [3] 选择',
    });
  }

  private queueEvolution(weapon: WeaponId, levelRequired: boolean): void {
    if (!isEvolutionWeapon(weapon)) return;
    if ((this.run.weapons[weapon] ?? 0) <= 0) return;
    if (this.run.evolutions[weapon]) return;
    if (levelRequired && !canEvolve(this.run, weapon)) return;
    if (this.pendingEvolutions.includes(weapon)) return;
    this.pendingEvolutions.push(weapon);
    this.choosing = true;
    hud.choices = this.pendingChoiceCount();
  }

  private maybeQueueEvolution(id: UpgradeId): void {
    if (!isEvolutionWeapon(id)) return;
    this.queueEvolution(id, true);
  }

  private applyChoice(index: number): void {
    if (!this.panelOpen) return;
    if (this.panelSource === 'evolution') {
      this.applyEvolutionChoice(index);
      return;
    }
    if (this.panelSource === 'reward') {
      this.applyRewardChoice(index);
      return;
    }
    if (index < 0 || index >= this.pendingChoices.length) return;
    const id = this.pendingChoices[index];
    applyUpgrade(this.run, id);
    if (this.panelSource === 'level') this.run.pendingLevels = Math.max(0, this.run.pendingLevels - 1);
    else this.pendingFree = Math.max(0, this.pendingFree - 1);
    this.maybeQueueEvolution(id);
    if (this.qaEvolutions.length > 0) {
      const queued = this.qaEvolutions;
      this.qaEvolutions = [];
      for (const weapon of queued) this.queueEvolution(weapon, true);
    }
    bus.emit('sfx', 'choose');
    this.fx.text(this.playerX, this.playerY - 44, `+${id.toUpperCase()}`, '#00ff41', 15);
    this.closePanel();
  }

  private applyEvolutionChoice(index: number): void {
    if (index < 0 || index >= this.pendingEvolutionCards.length) return;
    const weapon = this.pendingEvolutions.shift();
    const id = this.pendingEvolutionCards[index];
    if (!weapon) {
      this.closePanel();
      return;
    }
    applyEvolution(this.run, id);
    const def = EVOLUTION_DEFS[id];
    bus.emit('sfx', 'choose');
    this.fx.text(this.playerX, this.playerY - 44, `EVOLVE ${def.branch}`, '#ffe066', 16);
    bus.emit(EV.banner, {
      text: `${WEAPON_DEFS[weapon].name} · ${def.name}`,
      sub: def.tagline,
      ms: 1400,
    });
    this.closePanel();
  }

  private applyRewardChoice(index: number): void {
    if (index < 0 || index >= this.pendingRewards.length) return;
    const reward = this.pendingRewards[index];
    const outcome = applyBossReward(this.run, reward);
    this.pendingRewards = [];
    if (outcome.evolve) this.queueEvolution(outcome.evolve, false);
    if (outcome.upgraded) this.maybeQueueEvolution(outcome.upgraded);
    bus.emit('sfx', 'choose');
    this.fx.text(this.playerX, this.playerY - 44, reward.name, '#ffe066', 15);
    bus.emit(EV.banner, { text: 'BOSS REWARD', sub: reward.name, ms: 1200 });
    this.closePanel();
  }

  private closePanel(): void {
    this.pendingChoices = [];
    this.pendingEvolutionCards = [];
    hud.panel = null;
    hud.panelCards = 0;
    hud.choices = this.pendingChoiceCount();
    this.panelOpen = false;
    this.choosing = this.pendingChoiceCount() > 0;
    this.chooseTimer = 0.3;
    this.refreshHudLists();
  }

  private refreshHudLists(): void {
    hud.weapons = WEAPON_IDS.filter((id) => (this.run.weapons[id] ?? 0) > 0).map((id) => {
      const def = WEAPON_DEFS[id];
      const level = this.run.weapons[id] ?? 0;
      const evolution = this.run.evolutions[id];
      return {
        symbol: def.symbol,
        level,
        color: def.color,
        max: level >= def.maxLevel,
        evolution: evolution ? EVOLUTION_DEFS[evolution].branch : undefined,
      };
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
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (!p.dead) continue;
      if (p.sprite) this.images.release(p.sprite);
      const last = this.pickups.pop()!;
      if (i < this.pickups.length) this.pickups[i] = last;
    }
  }
}
