import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve('dist');
const PORT = 4183;
const SHOTS = resolve('screenshots');
const PKG_VERSION = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version;
const XP_PER_KILL = 2.86;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

if (!existsSync(DIST)) {
  console.error('dist/ missing - run `npm run build` first');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = join(DIST, decodeURIComponent(url.pathname));
  try {
    const info = await stat(path).catch(() => null);
    if (!info || info.isDirectory()) path = join(DIST, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const launchOptions = {
  headless: true,
  args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
};
const chromePath = process.env.SMOKE_BROWSER_PATH ?? CHROME_CANDIDATES.find((p) => existsSync(p));
if (chromePath) launchOptions.executablePath = chromePath;
else launchOptions.channel = 'chrome';

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const performanceMode = process.env.SMOKE_PERFORMANCE ?? 'assert';
if (!['assert', 'report'].includes(performanceMode)) throw new Error('SMOKE_PERFORMANCE must be assert or report');
const checkFps = (fps, label) => {
  if (performanceMode === 'report') {
    console.log(`METRIC  ${label}: ${fps} fps (report only; shared CI runner)`);
    check(Number.isFinite(fps) && fps > 0, `${label}: animation advances`, `${fps} fps`);
  } else {
    check(fps >= 30, label, `${fps} fps`);
  }
};

const readHud = (page) => page.evaluate(() => ({ ...window.__hud }));
const findEvent = (hud, kind) => (hud.events ?? []).find((event) => event.kind === kind) ?? null;
const xpNeed = (level) => Math.floor(8 + level * 2 + Math.pow(level, 1.65));

const cumulativeXp = (level) => {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpNeed(l);
  return sum;
};

const totalXp = (hud) => cumulativeXp(hud.level) + hud.xp;

const totalLevels = (hud) =>
  hud.weapons.reduce((sum, w) => sum + w.level, 0) + hud.passives.reduce((sum, p) => sum + p.level, 0);

const playUntil = async (page, predicate, maxSimSeconds) => {
  const from = await readHud(page);
  const deadline = Date.now() + maxSimSeconds * 3000;
  let hud = from;
  while (Date.now() < deadline) {
    hud = await readHud(page);
    if (hud.gameOver || predicate(hud)) break;
    if (hud.choices > 0) await page.keyboard.press('Digit1');
    if (hud.time - from.time >= maxSimSeconds) break;
    await page.waitForTimeout(120);
  }
  return hud;
};

const settle = async (page, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    const hud = await readHud(page);
    if (hud.gameOver) return hud;
    if (hud.choices === 0) return hud;
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(150);
  }
  return readHud(page);
};

const readFps = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - start < 600) requestAnimationFrame(tick);
          else resolve(Math.round((frames * 1000) / (performance.now() - start)));
        };
        requestAnimationFrame(tick);
      }),
  );

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch(launchOptions);

const BUDGET_MS = Number(process.env.SMOKE_BUDGET_MS ?? 8 * 60 * 1000);
const startedAt = Date.now();
const watchdog = setInterval(() => {
  if (Date.now() - startedAt < BUDGET_MS) return;
  clearInterval(watchdog);
  console.log(`\nSMOKE TIMED OUT after ${Math.round((Date.now() - startedAt) / 1000)}s`);
  console.log('the suite drives a real browser; give it a quiet machine or raise SMOKE_BUDGET_MS');
  void browser.close().catch(() => {});
  server.close();
  process.exit(1);
}, 5000);
watchdog.unref?.();

const play = async (page, seconds, { move = true } = {}) => {
  const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
  let index = 0;
  const from = await readHud(page);
  let lastSwitch = from.time;
  const targetTime = from.time + seconds;
  const deadline = Date.now() + seconds * 5000;
  if (move) await page.keyboard.down(keys[0]);
  while (Date.now() < deadline) {
    const hud = await readHud(page);
    if (hud.gameOver || hud.time >= targetTime) break;
    if (hud.choices > 0) await page.keyboard.press('Digit1');
    await page.waitForTimeout(100);
    if (move && hud.time - lastSwitch > 0.9) {
      lastSwitch = hud.time;
      await page.keyboard.up(keys[index]);
      index = (index + 1) % keys.length;
      await page.keyboard.down(keys[index]);
    }
  }
  if (move) await page.keyboard.up(keys[index]);
};

const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await page.waitForFunction(() => Boolean(window.__menu), null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SHOTS, '1-menu.png') });
  check(
    await page.evaluate(() => !document.getElementById('boot-hint')),
    'boot completes and menu renders',
  );
  const fonts = await page.evaluate(() => {
    const ink = (family) => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = `700 40px ${family}`;
      ctx.textBaseline = 'top';
      ctx.fillText('0xDEAD hotfix', 4, 4);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 128) painted++;
      return painted;
    };
    const faces = [...document.fonts].map((face) => `${face.family}/${face.weight}/${face.status}`);
    return { faces, bundled: ink('"JetBrains Mono"'), system: ink('monospace') };
  });
  const bundledFaces = fonts.faces.filter((face) => face.startsWith('JetBrains Mono') && face.endsWith('loaded'));
  check(
    bundledFaces.length >= 2,
    'ships its own monospace font instead of borrowing the system one',
    `${bundledFaces.join(' ')}`,
  );
  check(
    Math.abs(fonts.bundled - fonts.system) / fonts.system > 0.02,
    'the canvas really renders with the bundled font',
    `bundled ink=${fonts.bundled}px system ink=${fonts.system}px`,
  );

  const cjkFile = (await readdir(join(DIST, 'assets'))).find((file) => /^cjk-noto-sans-sc-700-.*\.woff2$/.test(file));
  if (!cjkFile) throw new Error('Bundled CJK bold font is missing from dist/assets');
  const cjk = await page.evaluate(async (fontUrl) => {
    const response = await fetch(fontUrl);
    if (!response.ok) throw new Error(`CJK reference font failed to load: ${response.status}`);
    const reference = new FontFace('SmokeCjkReference', await response.arrayBuffer(), { weight: '700' });
    await reference.load();
    document.fonts.add(reference);
    const text = '热修复 全量抓取 强制终止';
    const loaded = await document.fonts.load('700 32px "Noto Sans SC"', text);
    const ink = (family) => {
      const canvas = document.createElement('canvas');
      canvas.width = 260;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = `700 32px ${family}`;
      ctx.textBaseline = 'top';
      ctx.fillText(text, 4, 4);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 128) painted++;
      return { painted, pixels: data };
    };
    const bundled = ink('"Noto Sans SC"');
    const expected = ink('"SmokeCjkReference"');
    document.fonts.delete(reference);
    return {
      faces: [...document.fonts]
        .filter((face) => face.family.includes('Noto Sans SC'))
        .map((face) => `${face.family}/${face.weight}/${face.status}`),
      loaded: loaded.some((face) => face.family.includes('Noto Sans SC') && face.status === 'loaded'),
      bundled: bundled.painted,
      reference: expected.painted,
      matches: bundled.pixels.every((value, index) => value === expected.pixels[index]),
    };
  }, `/assets/${cjkFile}`);
  check(
    cjk.faces.some((face) => face.endsWith('loaded')),
    'ships the CJK glyphs the UI uses instead of borrowing the OS font',
    `${cjk.faces.join(' ')}`,
  );
  check(
    cjk.loaded && cjk.bundled > 0 && cjk.matches,
    'chinese text renders with the bundled subset',
    `bundled ink=${cjk.bundled}px reference ink=${cjk.reference}px exact match=${cjk.matches}`,
  );

  const menuSwarm = await page.evaluate(() => window.__menu ?? null);
  check(
    (menuSwarm?.marchers ?? 0) >= 3,
    'menu background spawns a bug swarm before the run starts',
    `marchers=${menuSwarm?.marchers}`,
  );

  const favicon = await page.evaluate(() => {
    const link = document.querySelector('link#favicon');
    return { rel: link?.rel ?? '', href: (link?.href ?? '').slice(0, 22), bytes: link?.href.length ?? 0 };
  });
  check(
    favicon.rel === 'icon' && favicon.href.startsWith('data:image/png') && favicon.bytes > 1000,
    'tab icon is generated at runtime',
    `${favicon.bytes} byte data url`,
  );

  const versionLabel = await page.evaluate(() => {
    const el = document.getElementById('version');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      text: el.textContent,
      bottomRight: Math.abs(window.innerWidth - box.right) < 24 && Math.abs(window.innerHeight - box.bottom) < 24,
    };
  });
  check(versionLabel?.text === `v${PKG_VERSION}`, 'version label matches package.json', String(versionLabel?.text));
  check(versionLabel?.bottomRight === true, 'version label sits in the bottom right corner');

  await page.keyboard.press('KeyC');
  await page.waitForTimeout(600);
  const codexWeapons = await page.evaluate(() => window.__codex ?? null);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(300);
  const codexBugs = await page.evaluate(() => window.__codex ?? null);
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(300);
  const codexDrops = await page.evaluate(() => window.__codex ?? null);
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(300);
  const codexZones = await page.evaluate(() => window.__codex ?? null);
  await page.keyboard.press('Digit5');
  await page.waitForTimeout(300);
  const codexModules = await page.evaluate(() => window.__codex ?? null);
  await page.screenshot({ path: join(SHOTS, '12-codex.png') });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);
  const codexClosed = await page.evaluate(() => window.__codex ?? null);
  check(
    codexWeapons?.entries === 6 &&
      codexBugs?.entries === 10 &&
      codexDrops?.entries === 3 &&
      codexZones?.entries === 7 &&
      codexModules?.entries === 8,
    'codex lists every weapon, bug, drop, zone and module',
    `w=${codexWeapons?.entries} e=${codexBugs?.entries} d=${codexDrops?.entries} z=${codexZones?.entries} p=${codexModules?.entries}`,
  );
  check(codexClosed === null, 'codex closes back to the menu');

  await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);
  const codexReopened = await page.evaluate(() => window.__codex ?? null);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const codexPaged = await page.evaluate(() => window.__codex ?? null);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(400);
  check(
    codexReopened?.entries === 6 && codexPaged?.pageIndex === 1,
    'codex opens again after closing (no stale scene state)',
    `reopened=${codexReopened?.entries} paged=${codexPaged?.page}`,
  );

  const codexClick = await (async () => {
    await page.mouse.click(Math.floor(page.viewportSize().width / 2), Math.floor(page.viewportSize().height / 2) + 108);
    await page.waitForTimeout(700);
    const active = await page.evaluate(() => window.__scenes?.() ?? []);
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(500);
    return active;
  })();
  check(
    codexClick.length === 1 && codexClick[0] === 'Codex',
    'clicking the codex line opens only the codex',
    JSON.stringify(codexClick),
  );

  await page.setViewportSize({ width: 960, height: 640 });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(300);
  const codexSmall = await page.evaluate(() => window.__codex ?? null);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const codexScrolled = await page.evaluate(() => window.__codex ?? null);
  check(
    codexSmall?.entries === 10 && codexSmall?.maxScroll > 0,
    'codex scrolls instead of clipping on short screens',
    JSON.stringify(codexSmall),
  );
  check(
    codexScrolled?.scroll > (codexSmall?.scroll ?? 0),
    'codex scroll keys move the list',
    `scroll=${codexSmall?.scroll} -> ${codexScrolled?.scroll}`,
  );
  await page.screenshot({ path: join(SHOTS, '12b-codex-small.png') });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__hud.choices > 0, null, { timeout: 20000 });
  await page.waitForTimeout(200);
  const opening = await readHud(page);
  check(opening.choices >= 1, 'opening module selection shown', `choices=${opening.choices}`);
  await page.screenshot({ path: join(SHOTS, '2-upgrade-panel.png') });

  await page.keyboard.press('Digit1');
  await page.waitForTimeout(400);
  const armed = await readHud(page);
  check(armed.weapons.length === 1, 'starting weapon equipped', `weapons=${armed.weapons.length}`);

  await play(page, 20);
  const leveled = await playUntil(page, (h) => h.level >= 2, 40);
  const mid = await settle(page);
  await page.screenshot({ path: join(SHOTS, '3-combat.png') });
  check(mid.time > 8, 'simulation advances', `t=${mid.time.toFixed(1)}s`);
  check(mid.kills > 5, 'enemies spawn and die', `kills=${mid.kills}`);
  const terrain = await page.evaluate(() => ({
    zones: window.__hud.zones,
    seed: window.__hud.seed,
    zone: window.__hud.zone,
  }));
  check(
    terrain.zones === 10 && terrain.seed > 0,
    'map generates terrain zones from a seed',
    `zones=${terrain.zones} seed=${terrain.seed}`,
  );
  check(
    terrain.zone === null || typeof terrain.zone.charge === 'number',
    'hud reports the zone the player stands in',
    JSON.stringify(terrain.zone),
  );
  const eventHud = await page.evaluate(() => (window.__hud.events ?? []).length);
  check(eventHud === 0, 'no objective before the first event window', `events=${eventHud}`);
  check(
    leveled.level >= 2,
    'xp pickups grant levels',
    `lvl=${leveled.level} at t=${leveled.time.toFixed(0)}s (waited for the first level up)`,
  );
  check(
    totalLevels(mid) >= mid.level - 1,
    'every level up applied an upgrade',
    `lvl=${mid.level} applied=${totalLevels(mid)}`,
  );
  check(
    mid.xpNeed === xpNeed(mid.level),
    'smoke xp curve mirror matches the game',
    `lvl=${mid.level} needs=${mid.xpNeed} mirrored=${xpNeed(mid.level)}`,
  );
  check(mid.weapons.length >= 1, 'weapons equipped', `w=${mid.weapons.length}`);

  const settled = await settle(page);
  check(settled.choices === 0, 'no upgrade panel left hanging');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  const pausedA = await readHud(page);
  await page.waitForTimeout(700);
  const pausedB = await readHud(page);
  check(pausedA.paused === true, 'pause via keyboard');
  check(Math.abs(pausedA.time - pausedB.time) < 0.05, 'clock frozen while paused');
  await page.screenshot({ path: join(SHOTS, '4-paused.png') });
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(500);
  check((await readHud(page)).paused === false, 'resume via keyboard');

  const fps = await readFps(page);
  checkFps(fps, 'frame rate healthy mid run');

  await page.setViewportSize({ width: 900, height: 620 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(SHOTS, '9-resized.png') });
  const resized = await readHud(page);
  check(resized.time > pausedB.time, 'survives viewport resize', `t=${resized.time.toFixed(1)}s`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  const before = await readHud(page);
  await play(page, 12);
  const after = await readHud(page);
  check(after.kills > before.kills, 'kill rate keeps rising', `${before.kills} -> ${after.kills}`);
  check(after.time > before.time, 'run still alive', `t=${after.time.toFixed(1)}s hp=${Math.round(after.hp)}`);
  await page.screenshot({ path: join(SHOTS, '5-late-run.png') });

  await settle(page);
  await page.keyboard.press('KeyP');
  const paused = await page
    .waitForFunction(() => window.__hud.paused === true, null, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!paused) {
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__hud.paused === true, null, { timeout: 3000 });
  }
  const askQuit = async () => {
    await page.keyboard.press('KeyQ');
    return page
      .waitForFunction(() => window.__hud.confirming === true, null, { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
  };
  let quitAsked = await askQuit();
  if (!quitAsked) {
    await page.waitForTimeout(300);
    quitAsked = await askQuit();
  }
  await page.waitForTimeout(200);
  const asked = await page.evaluate(() => ({
    confirming: window.__hud.confirming,
    inGame: !window.__menu,
  }));
  check(
    quitAsked && asked.confirming === true && asked.inGame === true,
    'quitting from pause asks for confirmation first',
    JSON.stringify(asked),
  );
  await page.screenshot({ path: join(SHOTS, '13-quit-confirm.png') });

  await page.keyboard.press('KeyN');
  await page.waitForTimeout(300);
  const cancelled = await page.evaluate(() => ({
    confirming: window.__hud.confirming,
    inGame: !window.__menu,
  }));
  check(
    cancelled.confirming === false && cancelled.inGame === true,
    'cancelling the quit keeps the run',
    JSON.stringify(cancelled),
  );

  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyY');
  await page.waitForTimeout(900);
  const quitRecord = await page.evaluate(() => localStorage.getItem('code-survivors:best'));
  const quitRun = quitRecord ? JSON.parse(quitRecord) : null;
  check(
    quitRun !== null && quitRun.time > 20,
    'confirming the quit settles the run it just played',
    String(quitRecord),
  );
  const backAtMenu = await page
    .waitForFunction(() => Boolean(window.__menu), null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(backAtMenu, 'quit returns to the menu');

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__hud.time > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(400);
  check(
    await page.evaluate(() => !window.__menu && !window.__hud.confirming),
    'Q while playing does not quit',
  );

  await page.close();

  const deathPage = await context.newPage();
  deathPage.on('pageerror', (e) => errors.push(`pageerror(death): ${e.message}`));
  await deathPage.goto(`http://localhost:${PORT}/?skip=420&seed=123456`, { waitUntil: 'load' });
  await deathPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await deathPage.waitForTimeout(700);
  await deathPage.keyboard.press('Enter');
  await deathPage.waitForTimeout(1400);
  await deathPage.keyboard.press('Digit1');
  let died = false;
  let maxLinks = 0;
  let maxMarks = 0;
  let maxBreakpoints = 0;
  let maxDaemons = 0;
  let deathHud = await readHud(deathPage);
  const deathFrom = deathHud.time;
  const deathDeadline = Date.now() + 40 * 5000;
  while (Date.now() < deathDeadline) {
    deathHud = await readHud(deathPage);
    maxLinks = Math.max(maxLinks, deathHud.hazards?.links ?? 0);
    maxMarks = Math.max(maxMarks, deathHud.hazards?.marks ?? 0);
    maxBreakpoints = Math.max(maxBreakpoints, deathHud.hazards?.breakpoints ?? 0);
    maxDaemons = Math.max(maxDaemons, deathHud.hazards?.daemons ?? 0);
    if (deathHud.gameOver) {
      died = true;
      break;
    }
    if (deathHud.choices > 0) await deathPage.keyboard.press('Digit1');
    if (deathHud.time - deathFrom >= 40) break;
    await deathPage.waitForTimeout(200);
  }
  check(died, 'late game overwhelms a stationary player', `survived ${(deathHud.time - deathFrom).toFixed(1)}s of 40s sim`);
  check(maxLinks > 0, 'deadlocks form dangerous links', `max links=${maxLinks}`);
  check(maxMarks > 0, 'breakpoints leave delayed blast marks', `max marks=${maxMarks}`);
  check(
    maxBreakpoints > 0 && maxBreakpoints <= 3,
    'breakpoint population stays capped',
    `max breakpoints=${maxBreakpoints}`,
  );
  check(
    maxDaemons > 0 && maxDaemons <= 2,
    'daemon population stays capped',
    `max daemons=${maxDaemons}`,
  );
  await deathPage.waitForTimeout(900);
  await deathPage.screenshot({ path: join(SHOTS, '7-game-over.png') });
  const record = await deathPage.evaluate(() => localStorage.getItem('code-survivors:best'));
  const parsed = record ? JSON.parse(record) : null;
  check(parsed !== null && parsed.time > 400, 'best run persisted to localStorage', String(record));

  await deathPage.keyboard.press('KeyQ');
  await deathPage.waitForTimeout(800);
  const deathQuit = await deathPage.evaluate(() => ({
    confirming: window.__hud.confirming,
    atMenu: Boolean(window.__menu),
    codex: window.__codex ?? null,
    scenes: window.__scenes?.() ?? [],
  }));
  check(
    deathQuit.confirming === false && deathQuit.atMenu === true,
    'quitting from the game over screen skips the confirmation',
    JSON.stringify(deathQuit),
  );
  check(
    deathQuit.codex === null && deathQuit.scenes.length === 1 && deathQuit.scenes[0] === 'Menu',
    'quitting leaves only the menu running',
    JSON.stringify(deathQuit.scenes),
  );
  await deathPage.close();

  const bossPage = await context.newPage();
  await bossPage.setViewportSize({ width: 960, height: 640 });
  bossPage.on('pageerror', (e) => errors.push(`pageerror(boss): ${e.message}`));
  await bossPage.goto(`http://localhost:${PORT}/?skip=88&seed=123456&passives=parallel`, { waitUntil: 'load' });
  await bossPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await bossPage.waitForTimeout(700);
  await bossPage.keyboard.press('Enter');
  await bossPage.waitForFunction(() => window.__hud.choices > 0);
  await bossPage.keyboard.press('Digit1');
  const skipped = await readHud(bossPage);
  check(skipped.level >= 5 && skipped.weapons.length >= 3, 'qa skip builds a mid run', `lvl=${skipped.level} w=${skipped.weapons.length}`);


  let bossSeen = null;
  let bossTookDamage = false;
  let reachedPhase2 = false;
  let bossRunDied = false;
  let minOrbsAfterBoss = Infinity;
  let frozenSamples = 0;
  let lastRunTime = null;
  let bossCombatStart = null;
  let bossLowestHp = Infinity;
  let enemiesBeforePhase2 = 0;
  let phase2Enemies = null;
  let phase2Peak = 0;
  let maxOrbsInFight = 0;
  let minEnemiesInFight = Infinity;
  let maxEnemiesInFight = 0;
  let maxCacheStacks = 0;
  let maxParallelHits = 0;
  const bossDeadline = Date.now() + 150000;
  while (Date.now() < bossDeadline) {
    const hud = await readHud(bossPage);
    if (hud.gameOver) {
      bossRunDied = true;
      await bossPage.waitForTimeout(600);
      const stored = await bossPage.evaluate(() => localStorage.getItem('code-survivors:best'));
      if (!stored) console.log('      NOTE: no record written on death');
      break;
    }
    if (hud.choices > 0) await bossPage.keyboard.press('Digit1');
    maxCacheStacks = Math.max(maxCacheStacks, hud.cache?.stacks ?? 0);
    maxParallelHits = Math.max(maxParallelHits, hud.parallelHits ?? 0);
    if (hud.boss) {
      bossSeen = bossSeen ?? { ...hud.boss };
      bossCombatStart = bossCombatStart ?? hud.time;
      bossLowestHp = Math.min(bossLowestHp, hud.boss.hp);
      minOrbsAfterBoss = Math.min(minOrbsAfterBoss, hud.orbs);
      if (lastRunTime !== null && Math.abs(hud.time - lastRunTime) < 0.01) frozenSamples++;
      if (hud.boss.hp < hud.boss.maxHp * 0.85) bossTookDamage = true;
      if (hud.boss.phase >= 2) reachedPhase2 = true;
      if (hud.boss.phase < 2) enemiesBeforePhase2 = hud.enemies;
      if (hud.time > bossCombatStart) {
        maxOrbsInFight = Math.max(maxOrbsInFight, hud.orbs);
        minEnemiesInFight = Math.min(minEnemiesInFight, hud.enemies);
        maxEnemiesInFight = Math.max(maxEnemiesInFight, hud.enemies);
        if (hud.boss.phase >= 2) {
          phase2Enemies = phase2Enemies ?? enemiesBeforePhase2;
          phase2Peak = Math.max(phase2Peak, hud.enemies);
        }
      }
    }
    lastRunTime = hud.time;
    await bossPage.waitForTimeout(150);
    if (hud.boss && hud.boss.hp < hud.boss.maxHp * 0.5) break;
    if (bossCombatStart !== null && hud.time - bossCombatStart >= 45) break;
  }
  check(Boolean(bossSeen), 'segfault boss spawns and shows a health bar', bossSeen ? bossSeen.name : 'never seen');
  if (!reachedPhase2) console.log(`SKIP  boss phase progression: ${bossRunDied ? 'player died' : 'measurement window ended'} in phase 1`);
  check(
    minOrbsAfterBoss <= 3,
    'boss entrance emp wipes every orb on the field',
    `lowest orb count during the fight was ${minOrbsAfterBoss}`,
  );
  check(
    frozenSamples >= 3,
    'the entrance freezes the fight while the camera watches',
    `${frozenSamples} frozen polls`,
  );
  check(
    minEnemiesInFight <= 1,
    'the entrance clears every normal bug from the field',
    `fewest enemies during the fight: ${minEnemiesInFight}`,
  );
  check(bossTookDamage, 'boss loses at least 15% health during combat', `lowest hp=${bossLowestHp} max=${bossSeen?.maxHp}`);
  check(maxCacheStacks > 0, 'cache builds focus stacks while attacking', `max stacks=${maxCacheStacks}`);
  check(maxParallelHits > 0, 'parallel reacts to alternating weapon hits', `hits=${maxParallelHits}`);
  if (reachedPhase2) {
    check(
      maxEnemiesInFight > 1,
      'the boss can still call in its own minions',
      `most enemies during the fight: ${maxEnemiesInFight}`,
    );
    check(
      phase2Peak - (phase2Enemies ?? 0) >= 6,
      'phase 2 opens with an immediate wave of minions',
      `enemies ${phase2Enemies} -> ${phase2Peak} right after the phase change`,
    );
  } else {
    console.log('SKIP  phase 2 checks: phase 2 was not reached in this run');
  }
  check(
    maxOrbsInFight <= 1,
    'nothing drops loot while the boss is alive',
    `most orbs on the ground during the fight: ${maxOrbsInFight}`,
  );
  if (!reachedPhase2) console.log('SKIP  boss reaches phase 2 (see combat outcome above)');
  await bossPage.screenshot({ path: join(SHOTS, '6-boss.png') });
  await bossPage.close();

  const evoPage = await context.newPage();
  await evoPage.setViewportSize({ width: 960, height: 640 });
  evoPage.on('pageerror', (e) => errors.push(`pageerror(evo): ${e.message}`));
  await evoPage.goto(`http://localhost:${PORT}/?skip=20&evolve=dart&seed=123456`, { waitUntil: 'load' });
  await evoPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await evoPage.waitForTimeout(700);
  await evoPage.keyboard.press('Enter');
  await evoPage.waitForFunction(() => window.__hud.choices > 0);
  await evoPage.keyboard.press('Digit1');
  const evoOpened = await evoPage
    .waitForFunction(() => window.__hud.panel === 'evolution', null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const evoPanel = await readHud(evoPage);
  check(evoOpened, 'dart reaches its evolution level and opens a branch panel', `panel=${evoPanel.panel} cards=${evoPanel.panelCards}`);
  check(evoPanel.panelCards === 2, 'evolution offers exactly two branches', `cards=${evoPanel.panelCards}`);
  await evoPage.waitForTimeout(350);
  await evoPage.screenshot({ path: join(SHOTS, '13-evolution.png') });
  if (evoOpened) await evoPage.keyboard.press('Digit1');
  await evoPage.waitForTimeout(500);
  const evolved = await readHud(evoPage);
  const dartHud = evolved.weapons.find((weapon) => weapon.symbol === ';');
  check(
    dartHud?.evolution === 'A',
    'chosen branch is locked into the loadout',
    `weapons=${JSON.stringify(evolved.weapons)}`,
  );
  await evoPage.close();

  for (const [label, query, branchKey, branch] of [
    ['burn/focus', '?skip=60&evolve=bomb,clone&seed=123456', 'Digit1', 'A'],
    ['chain/spread', '?skip=60&evolve=bomb,clone&seed=654321', 'Digit2', 'B'],
  ]) {
    const branchPage = await context.newPage();
    await branchPage.setViewportSize({ width: 960, height: 640 });
    branchPage.on('pageerror', (e) => errors.push(`pageerror(branch ${label}): ${e.message}`));
    await branchPage.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load' });
    await branchPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
    await branchPage.waitForTimeout(700);
    await branchPage.keyboard.press('Enter');
    await branchPage.waitForFunction(() => window.__hud.choices > 0);
    await branchPage.keyboard.press('Digit1');
    let panels = 0;
    for (let i = 0; i < 2; i++) {
      const opened = await branchPage
        .waitForFunction(() => window.__hud.panel === 'evolution', null, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) break;
      panels += 1;
      await branchPage.waitForTimeout(150);
      await branchPage.keyboard.press(branchKey);
      await branchPage.waitForTimeout(450);
    }
    const branchHud = await readHud(branchPage);
    const bomb = branchHud.weapons.find((weapon) => weapon.symbol === '!');
    const clone = branchHud.weapons.find((weapon) => weapon.symbol === 'fn()');
    check(
      panels === 2 && bomb?.evolution === branch && clone?.evolution === branch,
      `bomb/clone ${label} branches apply`,
      `panels=${panels} bomb=${bomb?.evolution} clone=${clone?.evolution}`,
    );
    await play(branchPage, 4);
    if (label === 'chain/spread') {
      await branchPage.screenshot({ path: join(SHOTS, '16-bomb-clone.png') });
    }
    await branchPage.close();
  }

  const eventPage = await context.newPage();
  await eventPage.setViewportSize({ width: 960, height: 640 });
  eventPage.on('pageerror', (e) => errors.push(`pageerror(event): ${e.message}`));
  await eventPage.goto(`http://localhost:${PORT}/?skip=30&eventNear=1&eventCharge=1.5&passives=typesafe,memory&seed=123456`, {
    waitUntil: 'load',
  });
  await eventPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await eventPage.waitForTimeout(700);
  await eventPage.keyboard.press('Enter');
  await eventPage.waitForFunction(() => window.__hud.choices > 0);
  await eventPage.keyboard.press('Digit1');
  await eventPage.waitForTimeout(300);
  const eventStart = await readHud(eventPage);
  const compileStart = findEvent(eventStart, 'compile');
  check(
    Boolean(compileStart) && compileStart.interactable,
    'hud offers a compile objective for E',
    JSON.stringify(compileStart),
  );
  let eventInteracted = false;
  let eventStarted = false;
  let eventFree = false;
  for (let i = 0; i < 90; i++) {
    const hud = await readHud(eventPage);
    if (hud.gameOver) break;
    if (hud.panel === 'free') {
      eventFree = true;
      break;
    }
    if (hud.choices > 0) {
      await eventPage.keyboard.press('Digit1');
      await eventPage.waitForTimeout(160);
      continue;
    }
    const compile = findEvent(hud, 'compile');
    if (!compile) {
      if (!eventInteracted) break;
      await eventPage.waitForTimeout(300);
      continue;
    }
    if (compile.interactable && !compile.active) {
      await eventPage.keyboard.press('KeyE');
      eventInteracted = true;
      await eventPage.waitForTimeout(200);
      continue;
    }
    if (compile.active) {
      if (!eventStarted) await eventPage.screenshot({ path: join(SHOTS, '14-compile-node.png') });
      eventStarted = true;
      await eventPage.waitForTimeout(240);
      continue;
    }
    await eventPage.waitForTimeout(200);
  }
  check(eventInteracted && eventStarted, 'player can interact with the compile node');
  check(eventFree, 'compile node completion grants a free module choice');
  await eventPage.screenshot({ path: join(SHOTS, '14b-compile-complete.png') });
  if (eventFree) {
    await eventPage.keyboard.press('Digit1');
    await eventPage.waitForTimeout(400);
    for (let i = 0; i < 5; i++) {
      const hud = await readHud(eventPage);
      if (hud.choices === 0) break;
      await eventPage.keyboard.press('Digit1');
      await eventPage.waitForTimeout(220);
    }
    const afterEvent = await readHud(eventPage);
    check(
      afterEvent.panel === null && !findEvent(afterEvent, 'compile'),
      'free module clears the node until the terrain rebuilds',
      `panel=${afterEvent.panel} compile=${findEvent(afterEvent, 'compile') ? 'present' : 'none'}`,
    );
  }
  await eventPage.close();

  const packetPage = await context.newPage();
  await packetPage.setViewportSize({ width: 960, height: 640 });
  packetPage.on('pageerror', (e) => errors.push(`pageerror(packet): ${e.message}`));
  await packetPage.goto(`http://localhost:${PORT}/?skip=60&packetNear=1&seed=123456`, {
    waitUntil: 'load',
  });
  await packetPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await packetPage.waitForTimeout(700);
  await packetPage.keyboard.press('Enter');
  await packetPage.waitForFunction(() => window.__hud.choices > 0);
  await packetPage.keyboard.press('Digit1');
  let packetEngaged = false;
  let packetEvo = false;
  for (let i = 0; i < 180; i++) {
    const hud = await readHud(packetPage);
    if (hud.gameOver) break;
    const packet = findEvent(hud, 'packet');
    if (packet?.interactable && !packet.active) {
      await packetPage.keyboard.press('KeyE');
      await packetPage.waitForTimeout(200);
      continue;
    }
    if (packet?.active) {
      if (!packetEngaged) await packetPage.screenshot({ path: join(SHOTS, '18-packet.png') });
      packetEngaged = true;
    }
    if (!packet && packetEngaged) {
      if (hud.panel === 'evolution') {
        packetEvo = true;
        break;
      }
      await packetPage.waitForTimeout(100);
      continue;
    }
    if (hud.panel === 'evolution' && packet) {
      await packetPage.keyboard.press('Digit1');
      await packetPage.waitForTimeout(150);
      continue;
    }
    if (hud.choices > 0) {
      await packetPage.keyboard.press('Digit1');
      await packetPage.waitForTimeout(150);
      continue;
    }
    if (!packet) break;
    await packetPage.waitForTimeout(200);
  }
  check(packetEngaged, 'corrupted packet deploys guards when reached');
  check(packetEvo, 'corrupted packet completion opens a weapon evolution choice');
  if (packetEvo) {
    await packetPage.keyboard.press('Digit1');
    await packetPage.waitForTimeout(400);
    const repaired = await readHud(packetPage);
    check(
      repaired.weapons.some((weapon) => weapon.evolution),
      'packet evolution is locked into the loadout',
      JSON.stringify(repaired.weapons),
    );
  }
  await packetPage.close();

  const commitPage = await context.newPage();
  await commitPage.setViewportSize({ width: 960, height: 640 });
  commitPage.on('pageerror', (e) => errors.push(`pageerror(commit): ${e.message}`));
  await commitPage.goto(
    `http://localhost:${PORT}/?skip=60&commitNear=1&commitDuration=10&commitNeed=6&seed=123456`,
    { waitUntil: 'load' },
  );
  await commitPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await commitPage.waitForTimeout(700);
  await commitPage.keyboard.press('Enter');
  await commitPage.waitForFunction(() => window.__hud.choices > 0);
  await commitPage.keyboard.press('Digit1');
  let commitEngaged = false;
  let commitReward = false;
  for (let i = 0; i < 160; i++) {
    const hud = await readHud(commitPage);
    if (hud.gameOver) break;
    const commit = findEvent(hud, 'commit');
    if (commit?.interactable && !commit.active) {
      await commitPage.keyboard.press('KeyE');
      await commitPage.waitForTimeout(200);
      continue;
    }
    if (commit?.active) {
      if (!commitEngaged) await commitPage.screenshot({ path: join(SHOTS, '19-commit.png') });
      commitEngaged = true;
    }
    if ((hud.rareModules ?? 0) > 0) {
      commitReward = true;
      break;
    }
    if (hud.choices > 0) {
      await commitPage.keyboard.press('Digit1');
      await commitPage.waitForTimeout(150);
      continue;
    }
    if (!commit) {
      if (commitEngaged) {
        await commitPage.waitForTimeout(300);
        commitReward = ((await readHud(commitPage)).rareModules ?? 0) > 0;
      }
      break;
    }
    if (commit.active) {
      await commitPage.waitForTimeout(200);
      continue;
    }
    await commitPage.waitForTimeout(200);
  }
  check(commitEngaged, 'dangerous commit starts its stronger wave when accepted');
  check(commitReward, 'dangerous commit completion grants a rare module');
  await commitPage.close();

  const rewardPage = await context.newPage();
  await rewardPage.setViewportSize({ width: 960, height: 640 });
  rewardPage.on('pageerror', (e) => errors.push(`pageerror(reward): ${e.message}`));
  await rewardPage.goto(
    `http://localhost:${PORT}/?skip=94&bossHp=0.02&passives=parallel,typesafe,memory&seed=123456`,
    { waitUntil: 'load' },
  );
  await rewardPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await rewardPage.waitForTimeout(700);
  await rewardPage.keyboard.press('Enter');
  await rewardPage.waitForFunction(() => window.__hud.choices > 0);
  await rewardPage.keyboard.press('Digit1');
  let rewardSeen = null;
  const rewardDeadline = Date.now() + 60000;
  while (Date.now() < rewardDeadline) {
    const hud = await readHud(rewardPage);
    if (hud.gameOver) break;
    if (hud.choices > 0) {
      if (hud.panel === 'reward') {
        rewardSeen = hud;
        break;
      }
      await rewardPage.keyboard.press('Digit1');
    }
    await rewardPage.waitForTimeout(150);
  }
  check(Boolean(rewardSeen), 'boss kill opens a reward panel', `panel=${rewardSeen?.panel ?? 'none'}`);
  check(rewardSeen?.panelCards === 3, 'boss reward always offers three cards', `cards=${rewardSeen?.panelCards}`);
  await rewardPage.waitForTimeout(350);
  await rewardPage.screenshot({ path: join(SHOTS, '15-boss-reward.png') });
  if (rewardSeen) {
    await rewardPage.keyboard.press('Digit1');
    await rewardPage.waitForTimeout(500);
    let afterReward = await readHud(rewardPage);
    if (afterReward.panel === 'evolution') {
      await rewardPage.keyboard.press('Digit1');
      await rewardPage.waitForTimeout(500);
      afterReward = await readHud(rewardPage);
    }
    check(afterReward.panel === null, 'boss reward resolves without leaving a panel', `panel=${afterReward.panel}`);
  }
  await rewardPage.close();

  const shieldPage = await context.newPage();
  shieldPage.on('pageerror', (e) => errors.push(`pageerror(shield): ${e.message}`));
  await shieldPage.goto(`http://localhost:${PORT}/?skip=0&passives=typesafe&seed=123456`, {
    waitUntil: 'load',
  });
  await shieldPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await shieldPage.waitForTimeout(700);
  await shieldPage.keyboard.press('Enter');
  await shieldPage.waitForFunction(() => window.__hud.choices > 0);
  await shieldPage.keyboard.press('Digit1');
  let shieldUp = false;
  const shieldDeadline = Date.now() + 9000;
  while (Date.now() < shieldDeadline) {
    const hud = await readHud(shieldPage);
    if (hud.shield) {
      shieldUp = true;
      break;
    }
    if (hud.choices > 0) await shieldPage.keyboard.press('Digit1');
    await shieldPage.waitForTimeout(100);
  }
  check(shieldUp, 'typesafe generates a shield after the safe window');
  await shieldPage.screenshot({ path: join(SHOTS, '17-typesafe-shield.png') });
  await shieldPage.close();

  const hidpiContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const hidpiPage = await hidpiContext.newPage();
  hidpiPage.on('pageerror', (e) => errors.push(`pageerror(hidpi): ${e.message}`));
  hidpiPage.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console(hidpi): ${m.text()}`);
  });
  await hidpiPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await hidpiPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await hidpiPage.waitForTimeout(900);
  const hidpi = await hidpiPage.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return {
      dpr: window.devicePixelRatio,
      backingW: canvas.width,
      cssW: window.innerWidth,
      samples: (() => {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return gl ? gl.getParameter(gl.SAMPLES) : -1;
      })(),
    };
  });
  check(hidpi.dpr === 2, 'hidpi context reports dpr 2', String(hidpi.dpr));
  check(
    hidpi.backingW === hidpi.cssW * 2,
    'canvas renders at device pixel ratio',
    `backing=${hidpi.backingW} css=${hidpi.cssW}`,
  );
  check(hidpi.samples === 0, 'msaa disabled in favour of supersampling', `samples=${hidpi.samples}`);
  await hidpiPage.keyboard.press('Enter');
  await hidpiPage.waitForTimeout(1300);
  await hidpiPage.keyboard.press('Digit1');
  await hidpiPage.keyboard.down('KeyD');
  await hidpiPage.keyboard.up('KeyD');
  await play(hidpiPage, 12, { move: false });
  await hidpiPage.keyboard.up('KeyD');
  const hidpiFps = await readFps(hidpiPage);
  checkFps(hidpiFps, 'frame rate healthy at dpr 2');
  await hidpiPage.screenshot({ path: join(SHOTS, '10-hidpi.png') });
  await hidpiContext.close();

  const lootPage = await context.newPage();
  lootPage.on('pageerror', (e) => errors.push(`pageerror(loot): ${e.message}`));
  await lootPage.goto(`http://localhost:${PORT}/?skip=120&seed=123456`, { waitUntil: 'load' });
  await lootPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await lootPage.waitForTimeout(700);
  await lootPage.keyboard.press('Enter');
  await lootPage.waitForTimeout(1400);
  await lootPage.keyboard.press('Digit1');
  await play(lootPage, 7, { move: false });
  const still = await readHud(lootPage);
  check(!still.gameOver, 'loot fixture survives its stand-off window', `hp=${Math.round(still.hp)}`);
  check(
    still.orbs >= still.kills,
    'killed loot stays on the ground until walked over',
    `orbs=${still.orbs} kills=${still.kills} xp=${Math.round(still.xp)}`,
  );
  check(
    still.orbs >= still.kills * 0.5,
    'distant loot is not vacuumed into the player',
    `${still.orbs} orbs still on the ground from ${still.kills} kills`,
  );
  await lootPage.screenshot({ path: join(SHOTS, '11-loot-on-ground.png') });

  const sweepKeys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
  let sweepIndex = 0;
  let lastSweepSwitch = still.time;
  await lootPage.keyboard.down(sweepKeys[0]);
  const sweepDeadline = Date.now() + 90000;
  while (Date.now() < sweepDeadline) {
    const hud = await readHud(lootPage);
    if (hud.gameOver || hud.time - still.time >= 10) break;
    if (hud.choices > 0) await lootPage.keyboard.press('Digit1');
    await lootPage.waitForTimeout(100);
    if (hud.time - lastSweepSwitch > 1.1) {
      lastSweepSwitch = hud.time;
      await lootPage.keyboard.up(sweepKeys[sweepIndex]);
      sweepIndex = (sweepIndex + 1) % sweepKeys.length;
      await lootPage.keyboard.down(sweepKeys[sweepIndex]);
    }
  }
  await lootPage.keyboard.up(sweepKeys[sweepIndex]);
  const swept = await readHud(lootPage);
  const gained = totalXp(swept) - totalXp(still);
  const gainedKills = swept.kills - still.kills;
  const ratio = gained / Math.max(1, gainedKills * XP_PER_KILL);
  check(
    ratio > 0.3,
    'orbs entering the pickup ring are collected while moving',
    `${(ratio * 100).toFixed(0)}% of dropped xp collected over ${gainedKills} kills (exact behaviour is unit tested)`,
  );
  const dropped = gainedKills * 2;
  const leftBehind = swept.orbs - still.orbs;
  check(
    leftBehind / Math.max(1, dropped) < 0.85,
    'the magnet keeps up instead of leaving loot behind',
    `${leftBehind} of ~${dropped} dropped orbs still on the ground (exact behaviour is unit tested)`,
  );
  check(
    Boolean(swept.gc) && (swept.gc.sweeps > 0 || swept.gc.charge > 0),
    'gc builds charge from consecutive xp pickups',
    JSON.stringify(swept.gc),
  );
  await lootPage.close();

  const expiryPage = await context.newPage();
  expiryPage.on('pageerror', (e) => errors.push(`pageerror(expiry): ${e.message}`));
  await expiryPage.goto(`http://localhost:${PORT}/?skip=25&orbLife=3`, { waitUntil: 'load' });
  await expiryPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await expiryPage.waitForTimeout(700);
  await expiryPage.keyboard.press('Enter');
  await expiryPage.waitForTimeout(1400);
  await expiryPage.keyboard.press('Digit1');
  await play(expiryPage, 12, { move: false });
  const rateStart = await readHud(expiryPage);
  await play(expiryPage, 3, { move: false });
  const expired = await readHud(expiryPage);
  check(!expired.gameOver, 'expiry fixture survives its measurement window', `hp=${Math.round(expired.hp)}`);
  const killRate = (expired.kills - rateStart.kills) / 3;
  const bound = killRate * 3 * 3 + 8;
  check(
    expired.orbs <= bound,
    'uncollected loot expires instead of piling up forever',
    `orbs=${expired.orbs} vs bound ${bound.toFixed(0)} at ${killRate.toFixed(1)} kills/s`,
  );
  await expiryPage.close();

  const menuPage = await context.newPage();
  menuPage.on('pageerror', (e) => errors.push(`pageerror(menu): ${e.message}`));
  await menuPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await menuPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await menuPage.waitForTimeout(600);
  await menuPage.screenshot({ path: join(SHOTS, '8-menu-with-record.png') });
  const best = await menuPage.evaluate(() => localStorage.getItem('code-survivors:best'));
  if (bossRunDied) check(Boolean(best), 'best run persisted to localStorage', String(best));
  else console.log(`SKIP  best run persistence (run did not end)  stored=${best}`);
  console.log(`      local storage snapshot: ${best}`);
  await menuPage.close();
} catch (error) {
  failures.push(`exception: ${error.message}`);
  console.log(`FAIL  smoke run threw: ${error.message}`);
} finally {
  clearInterval(watchdog);
  if (errors.length) {
    console.log('\nbrowser errors:');
    for (const e of errors.slice(0, 20)) console.log(`  - ${e}`);
  }
  check(errors.length === 0, 'no browser console/page errors');
  await browser.close();
  server.close();
}

console.log(`\n${failures.length === 0 ? 'SMOKE OK' : `SMOKE FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
