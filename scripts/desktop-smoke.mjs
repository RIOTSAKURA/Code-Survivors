import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const errors = [];
const profile = await mkdtemp(path.join(tmpdir(), 'code-survivors-smoke-'));
const packaged = process.env.DESKTOP_PACKAGED === '1';
const executablePath = process.platform === 'darwin'
  ? path.resolve('release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Code Survivors.app', 'Contents', 'MacOS', 'Code Survivors')
  : path.resolve('release', 'win-unpacked', 'Code Survivors.exe');
let app;
let page;
try {
  app = await electron.launch({
    ...(packaged ? { executablePath } : {}),
    args: [...(packaged ? [] : ['.']), `--user-data-dir=${profile}`],
    timeout: 60000,
  });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const waitForMenu = () => page.waitForFunction(
    () => window.__scenes?.().includes('Menu'), null, { timeout: 60000 },
  );
  const reloadGame = async () => {
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload()),
    ]);
    await waitForMenu();
  };
  await page.waitForURL((url) => url.protocol === 'file:' && url.pathname.endsWith('/dist/index.html'));
  await waitForMenu();
  console.log('PASS desktop: initial navigation and menu ready');
  await page.context().setOffline(true);
  await reloadGame();
  console.log('PASS desktop: native reload while offline');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => document.fonts.check('400 32px "JetBrains Mono"')), true);
  await page.evaluate(() => localStorage.setItem('desktop-smoke', 'persistent'));
  await reloadGame();
  assert.equal(await page.evaluate(() => localStorage.getItem('desktop-smoke')), 'persistent');
  console.log('PASS desktop: storage survives native reload');
  assert.equal(await app.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return preferences.sandbox && preferences.contextIsolation && !preferences.nodeIntegration;
  }), true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__scenes?.().includes('Game') && window.__hud?.choices > 0);
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.__hud.time > 2);
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__hud.paused);
  const time = await page.evaluate(() => window.__hud.time);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__hud.time), time);
  assert.deepEqual(errors, []);
  console.log('PASS desktop: offline boot, fonts, storage, sandbox, combat and pause');
} catch (error) {
  console.error('Desktop browser errors:', errors);
  if (page && !page.isClosed()) {
    console.error('Desktop page URL:', page.url());
    await mkdir('screenshots/desktop', { recursive: true });
    await page.screenshot({ path: 'screenshots/desktop/failure.png', timeout: 5000 }).catch(() => {});
  }
  throw error;
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
