import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
const app = spawn(executable, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
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
  await page.locator('.file-row').nth(4).waitFor();
  assert.equal(page.url(), 'https://screenshot-redactor.local/index.html');
  assert.deepEqual(await page.evaluate(() => [isSecureContext, typeof window.require, typeof crypto.randomUUID]), [true, 'undefined', 'function']);
  assert.equal(await page.evaluate(async () => (await fetch('/package.json')).status), 404);

  const input = page.locator('#file-input');
  await input.setInputFiles(['account.png', 'account-team.png'].map((name) => resolve('docs/samples', name)));
  await page.getByRole('button', { name: 'account-team.png 待检查' }).waitFor();
  const button = (name) => page.getByRole('button', { name, exact: true });
  const artboard = page.locator('#artboard');
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
  console.log('Desktop smoke passed: local renderer, import, edit, copy, review, and ZIP export.');
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
