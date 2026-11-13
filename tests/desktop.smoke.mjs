import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { unzipSync } from 'fflate';

const executable = process.argv[2];
const app = await electron.launch(executable ? { executablePath: resolve(executable) } : { args: ['.'] });
const output = await mkdtemp(resolve(tmpdir(), 'redactor-smoke-'));
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.file-row').nth(4).waitFor();
  assert.match(page.url(), /^redactor:\/\/local\//);
  assert.deepEqual(await page.evaluate(() => [isSecureContext, typeof window.require, typeof crypto.randomUUID]), [true, 'undefined', 'function']);

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

  const path = resolve(output, 'redacted.zip');
  const download = app.evaluate(({ session }, destination) => new Promise((resolve, reject) => {
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(destination);
      item.once('done', (_result, state) => state === 'completed' ? resolve() : reject(new Error(state)));
    });
  }), path);
  await button('导出全部 ZIP').click();
  await download;
  const zip = unzipSync(await readFile(path));
  assert.deepEqual(Object.keys(zip), ['01-redacted.png', '02-redacted.png']);
  assert.deepEqual(errors, []);
  console.log('Desktop smoke passed: local renderer, import, edit, copy, review, and ZIP export.');
} finally {
  await app.close();
  await rm(output, { recursive: true, force: true });
}
