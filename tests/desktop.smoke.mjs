import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';

const executable = resolve(process.argv[2] ?? 'release/lightweight/win-unpacked/ScreenshotRedactor.exe');
const server = createServer();
await new Promise((done, reject) => server.once('error', reject).listen(0, '127.0.0.1', done));
const { port } = server.address();
await new Promise((done) => server.close(done));
const endpoint = `http://127.0.0.1:${port}`;
const output = await mkdtemp(resolve(tmpdir(), 'redactor-smoke-'));
const testProfile = resolve(output, 'profile');
const captureFolder = resolve(testProfile, 'ScreenshotRedactor', 'Captures');
await mkdir(captureFolder, { recursive: true });
const sample = await readFile(resolve('docs/samples/account.png'));
for (let i = 0; i < 30; i++) {
  await writeFile(resolve(captureFolder, `20261114-120000-${String(i).padStart(3, '0')}-aabbccdd.png`), sample);
}
const app = spawn(executable, [], { env: { ...process.env, SCREENSHOT_REDACTOR_TEST_PROFILE: testProfile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
const exited = new Promise((done) => app.once('close', done));
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) })).ok) break;
    } catch { /* Wait for WebView2 to start. */ }
    await delay(250);
  }
  browser = await chromium.connectOverCDP(endpoint, { timeout: 4000 });
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  const downloads = await browser.newBrowserCDPSession();
  await downloads.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output, eventsEnabled: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '选择图片', exact: true }).waitFor();
  assert.equal(await page.locator('.file-row').count(), 0);
  assert.equal(page.url(), 'https://screenshot-redactor.local/index.html');
  assert.deepEqual(await page.evaluate(() => [isSecureContext, typeof window.require, typeof crypto.randomUUID]), [true, 'undefined', 'function']);
  assert.equal(await page.evaluate(async () => (await fetch('/package.json')).status), 404);
  await page.getByRole('button', { name: '快捷键设置' }).click();
  const shortcuts = page.getByRole('dialog', { name: '快捷键设置' });
  const editHotkey = shortcuts.getByRole('button', { name: /录入截屏快捷键/ });
  await editHotkey.click();
  await page.keyboard.press('Control+Alt+F8');
  const editHistory = shortcuts.getByRole('button', { name: /录入截图剪贴板快捷键/ });
  await editHistory.click();
  await page.keyboard.press('Control+Alt+F8');
  await shortcuts.getByRole('button', { name: '保存快捷键' }).click();
  await shortcuts.getByText('截屏与截图剪贴板需要使用不同的快捷键。').waitFor();
  await shortcuts.getByRole('button', { name: '恢复默认' }).click();
  await editHotkey.click();
  await page.keyboard.press('Control+Alt+F8');
  await shortcuts.getByRole('button', { name: '保存快捷键' }).click();
  await shortcuts.waitFor({ state: 'hidden' });
  assert.match(await page.getByRole('button', { name: '区域截屏' }).getAttribute('title'), /Ctrl \+ Alt \+ F8/);
  assert.equal((await readFile(resolve(testProfile, 'ScreenshotRedactor', 'hotkeys.txt'), 'utf8')).trim(), '3:119\n6:121');
  await page.getByRole('button', { name: '截图剪贴板' }).click();
  const history = page.getByRole('dialog', { name: '截图剪贴板' });
  await history.getByRole('checkbox').nth(29).waitFor({ state: 'attached' });
  assert.equal(await history.getByRole('checkbox').count(), 30);
  await history.getByRole('checkbox').first().check();
  await history.getByRole('button', { name: '导入所选截图' }).click();
  await page.locator('.file-row').filter({ hasText: '截图-20261114-' }).waitFor();
  await page.getByRole('button', { name: '移除当前截图' }).click();

  const stage = await page.locator('#stage').boundingBox();
  const drag = await context.newCDPSession(page);
  const dropPoint = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  const dropData = { items: [], files: ['account.png', 'account-team.png'].map((name) => resolve('docs/samples', name)), dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver']) await drag.send('Input.dispatchDragEvent', { type, ...dropPoint, data: dropData });
  await page.getByText('松开以导入截图', { exact: true }).waitFor();
  await drag.send('Input.dispatchDragEvent', { type: 'drop', ...dropPoint, data: dropData });
  await page.getByRole('button', { name: 'account-team.png 待检查' }).waitFor();
  const button = (name) => page.getByRole('button', { name, exact: true });
  const artboard = page.locator('#artboard');
  await button('原图大小').click();
  const width = await artboard.evaluate((node) => Math.round(node.getBoundingClientRect().width * devicePixelRatio));
  assert.equal(width, 1120);
  await button('适应').click();
  await artboard.hover();
  const initialSize = await artboard.boundingBox();
  const ratio = await page.evaluate(() => devicePixelRatio);
  await page.keyboard.down('Control');
  try {
    await page.mouse.wheel(0, -220);
    await page.waitForFunction((width) => document.querySelector('#artboard').getBoundingClientRect().width > width * 1.2, initialSize.width);
  } finally {
    await page.keyboard.up('Control');
  }
  assert.equal(await page.evaluate(() => devicePixelRatio), ratio);
  await button('适应').click();
  await artboard.hover();
  const bounds = await artboard.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .33, bounds.y + bounds.height * .52);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .69, bounds.y + bounds.height * .71, { steps: 10 });
  await page.mouse.up();
  await button('批量应用遮挡').click();
  await page.getByRole('checkbox', { name: '全选可应用截图' }).check();
  await button('应用到 1 张').click();
  await button('成品预览').click();
  await page.keyboard.press('e');
  assert.equal(await page.locator('.file-row').nth(1).getAttribute('aria-current'), 'true');
  const pixel = await page.locator('#preview').evaluate((canvas) => [...canvas.getContext('2d').getImageData(570, 420, 1, 1).data]);
  assert.deepEqual(pixel, [0, 0, 0, 255]);
  await page.keyboard.press('e');

  await button('导出全部 ZIP').click();
  const path = resolve(output, 'screenshots-redacted.zip');
  let data;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { data = await readFile(path); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(250);
  }
  assert.ok(data, 'WebView2 did not save the ZIP');
  const zip = unzipSync(data);
  assert.deepEqual(Object.keys(zip), ['01-redacted.png', '02-redacted.png']);
  assert.deepEqual(errors, []);
  console.log('Desktop smoke passed: 30 local captures, history import, drag import, editing, and ZIP export.');
} finally {
  await browser?.close();
  if (app.exitCode === null) {
    const close = spawn('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`], { windowsHide: true });
    await new Promise((done) => close.once('exit', done));
    await Promise.race([exited, delay(4500, null, { ref: false })]);
    if (app.exitCode === null) app.kill();
  }
  await rm(output, { recursive: true, force: true });
}
