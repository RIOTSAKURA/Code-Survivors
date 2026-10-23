import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve('dist');
const PORT = 4183;
const SHOTS = resolve('screenshots');
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
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (chromePath) launchOptions.executablePath = chromePath;
else launchOptions.channel = 'chrome';

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const readHud = (page) => page.evaluate(() => ({ ...window.__hud }));
const cumulativeXp = (level) => {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += Math.floor(8 + l * 3.6 + Math.pow(l, 1.3));
  return sum;
};

const totalXp = (hud) => cumulativeXp(hud.level) + hud.xp;

const totalLevels = (hud) =>
  hud.weapons.reduce((sum, w) => sum + w.level, 0) + hud.passives.reduce((sum, p) => sum + p.level, 0);

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

const play = async (page, seconds, { move = true } = {}) => {
  const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
  let index = 0;
  let lastSwitch = Date.now();
  if (move) await page.keyboard.down(keys[0]);
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const hud = await readHud(page);
    if (hud.gameOver) break;
    if (hud.choices > 0) await page.keyboard.press('Digit1');
    await page.waitForTimeout(100);
    if (move && Date.now() - lastSwitch > 900) {
      lastSwitch = Date.now();
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
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SHOTS, '1-menu.png') });
  check(
    await page.evaluate(() => !document.getElementById('boot-hint')),
    'boot completes and menu renders',
  );

  await page.keyboard.press('Enter');
  await page.waitForTimeout(1400);
  const opening = await readHud(page);
  check(opening.choices >= 1, 'opening module selection shown', `choices=${opening.choices}`);
  await page.screenshot({ path: join(SHOTS, '2-upgrade-panel.png') });

  await page.keyboard.press('Digit1');
  await page.waitForTimeout(400);
  const armed = await readHud(page);
  check(armed.weapons.length === 1, 'starting weapon equipped', `weapons=${armed.weapons.length}`);

  await play(page, 20);
  const mid = await settle(page);
  await page.screenshot({ path: join(SHOTS, '3-combat.png') });
  check(mid.time > 8, 'simulation advances', `t=${mid.time.toFixed(1)}s`);
  check(mid.kills > 5, 'enemies spawn and die', `kills=${mid.kills}`);
  check(mid.level >= 2, 'xp pickups grant levels', `lvl=${mid.level}`);
  check(
    totalLevels(mid) >= mid.level - 1,
    'every level up applied an upgrade',
    `lvl=${mid.level} applied=${totalLevels(mid)}`,
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
  check(fps >= 30, 'frame rate healthy mid run', `${fps} fps`);

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

  await page.close();

  const deathPage = await context.newPage();
  deathPage.on('pageerror', (e) => errors.push(`pageerror(death): ${e.message}`));
  await deathPage.goto(`http://localhost:${PORT}/?skip=420`, { waitUntil: 'load' });
  await deathPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await deathPage.waitForTimeout(700);
  await deathPage.keyboard.press('Enter');
  await deathPage.waitForTimeout(1400);
  await deathPage.keyboard.press('Digit1');
  let died = false;
  const deathDeadline = Date.now() + 40000;
  while (Date.now() < deathDeadline) {
    const hud = await readHud(deathPage);
    if (hud.gameOver) {
      died = true;
      break;
    }
    if (hud.choices > 0) await deathPage.keyboard.press('Digit1');
    await deathPage.waitForTimeout(200);
  }
  check(died, 'late game overwhelms a stationary player');
  await deathPage.waitForTimeout(900);
  await deathPage.screenshot({ path: join(SHOTS, '7-game-over.png') });
  const record = await deathPage.evaluate(() => localStorage.getItem('code-survivors:best'));
  check(Boolean(record), 'best run persisted to localStorage', String(record));
  await deathPage.close();

  const bossPage = await context.newPage();
  bossPage.on('pageerror', (e) => errors.push(`pageerror(boss): ${e.message}`));
  await bossPage.goto(`http://localhost:${PORT}/?skip=88`, { waitUntil: 'load' });
  await bossPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await bossPage.waitForTimeout(700);
  await bossPage.keyboard.press('Enter');
  await bossPage.waitForTimeout(1400);
  await bossPage.keyboard.press('Digit1');
  const skipped = await readHud(bossPage);
  check(skipped.level >= 5 && skipped.weapons.length >= 3, 'qa skip builds a mid run', `lvl=${skipped.level} w=${skipped.weapons.length}`);


  let bossSeen = null;
  let sawPhase2 = false;
  let bossRunDied = false;
  await bossPage.keyboard.down('KeyD');
  const bossDeadline = Date.now() + 45000;
  let holding = null;
  let holdTick = 0;
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
    if (hud.boss) {
      bossSeen = bossSeen ?? { ...hud.boss };
      if (hud.boss.phase >= 2 || hud.boss.hp < hud.boss.maxHp * 0.85) sawPhase2 = true;
    }
    if (!bossSeen) {
      await bossPage.waitForTimeout(120);
      if (holding === null) {
        holding = 'KeyD';
      } else if (++holdTick % 10 === 0) {
        await bossPage.keyboard.up(holding);
        holding = holding === 'KeyD' ? 'KeyS' : 'KeyD';
        await bossPage.keyboard.down(holding);
      }
    } else {
      if (holding !== null) {
        await bossPage.keyboard.up(holding);
        holding = null;
      }
      await bossPage.waitForTimeout(150);
    }
    if (hud.boss && hud.boss.hp < hud.boss.maxHp * 0.5) break;
  }
  if (holding !== null) await bossPage.keyboard.up(holding);
  check(Boolean(bossSeen), 'segfault boss spawns and shows a health bar', bossSeen ? bossSeen.name : 'never seen');
  check(sawPhase2, 'boss takes damage and reaches phase 2');
  await bossPage.screenshot({ path: join(SHOTS, '6-boss.png') });
  await bossPage.close();

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
  const hidpiStart = Date.now();
  while (Date.now() - hidpiStart < 12000) {
    const hud = await readHud(hidpiPage);
    if (hud.gameOver) break;
    if (hud.choices > 0) await hidpiPage.keyboard.press('Digit1');
    await hidpiPage.waitForTimeout(150);
  }
  await hidpiPage.keyboard.up('KeyD');
  const hidpiFps = await readFps(hidpiPage);
  check(hidpiFps >= 30, 'frame rate healthy at dpr 2', `${hidpiFps} fps`);
  await hidpiPage.screenshot({ path: join(SHOTS, '10-hidpi.png') });
  await hidpiContext.close();

  const lootPage = await context.newPage();
  lootPage.on('pageerror', (e) => errors.push(`pageerror(loot): ${e.message}`));
  await lootPage.goto(`http://localhost:${PORT}/?skip=120`, { waitUntil: 'load' });
  await lootPage.waitForFunction(() => Boolean(window.__hud), null, { timeout: 20000 });
  await lootPage.waitForTimeout(700);
  await lootPage.keyboard.press('Enter');
  await lootPage.waitForTimeout(1400);
  await lootPage.keyboard.press('Digit1');
  await lootPage.waitForTimeout(7000);
  const still = await readHud(lootPage);
  check(
    still.orbs >= 10,
    'killed loot stays on the ground until walked over',
    `orbs=${still.orbs} kills=${still.kills} xp=${Math.round(still.xp)}`,
  );
  check(
    still.xp < still.kills * 8,
    'distant loot is not vacuumed into the player',
    `collected ${Math.round(still.xp)} xp from ${still.kills} kills`,
  );
  await lootPage.screenshot({ path: join(SHOTS, '11-loot-on-ground.png') });

  const sweepKeys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
  let sweepIndex = 0;
  let lastSweepSwitch = Date.now();
  await lootPage.keyboard.down(sweepKeys[0]);
  const sweepDeadline = Date.now() + 10000;
  while (Date.now() < sweepDeadline) {
    const hud = await readHud(lootPage);
    if (hud.gameOver) break;
    if (hud.choices > 0) await lootPage.keyboard.press('Digit1');
    await lootPage.waitForTimeout(100);
    if (Date.now() - lastSweepSwitch > 1100) {
      lastSweepSwitch = Date.now();
      await lootPage.keyboard.up(sweepKeys[sweepIndex]);
      sweepIndex = (sweepIndex + 1) % sweepKeys.length;
      await lootPage.keyboard.down(sweepKeys[sweepIndex]);
    }
  }
  await lootPage.keyboard.up(sweepKeys[sweepIndex]);
  const swept = await readHud(lootPage);
  const gained = totalXp(swept) - totalXp(still);
  const gainedKills = swept.kills - still.kills;
  const ratio = gained / Math.max(1, gainedKills * 3.2);
  check(
    ratio > 1.2,
    'orbs entering the pickup ring are collected while moving',
    `${(ratio * 100).toFixed(0)}% of dropped xp collected over ${gainedKills} kills`,
  );
  check(
    swept.orbs - still.orbs < gainedKills * 2.2,
    'the magnet keeps up instead of leaving loot behind',
    `orbs ${still.orbs} -> ${swept.orbs} over ${gainedKills} kills`,
  );
  await lootPage.close();

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
