import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

const assets = ['account.png', 'checkout.jpg', 'receipt.png'];
const demoCount = 5;

test('changes a selected mask style and flattens opaque color or mosaic into the preview', async ({ page }) => {
  await openSamples(page);
  const style = page.locator('#mask-style');
  const current = page.getByRole('button', { name: /^遮挡样式：/ });
  const artboard = await page.locator('#artboard').boundingBox();
  await style.hover();
  await page.mouse.wheel(0, 100);
  await expect(current).toHaveAccessibleName('遮挡样式：纯白');
  await expect(style).toHaveAttribute('data-style', 'white');
  expect(await page.locator('#artboard').boundingBox()).toEqual(artboard);
  const paletteButton = page.getByRole('button', { name: /^配色/ });
  await expect(paletteButton).toHaveAccessibleName('配色：原图配色');
  await page.getByRole('button', { name: '成品预览' }).click();
  const preview = page.locator('#preview');
  const pixels = (points) => preview.evaluate((canvas, positions) => positions.map(([x, y]) =>
    [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]), points);
  expect(await pixels([[470, 412], [415, 300]])).toEqual([[255, 255, 255, 255], [0, 0, 0, 255]]);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#masks .mask').first().click();
  await current.press('ArrowUp');
  await expect(current).toHaveAccessibleName('遮挡样式：纯黑');
  await page.getByRole('button', { name: '上一种遮挡样式' }).click();
  await expect(current).toHaveAccessibleName('遮挡样式：方块马赛克');
  const tile = page.locator('#masks .mask canvas');
  await expect(tile).toHaveCount(1);
  const firstPixel = () => tile.evaluate((canvas) => [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data]);
  const original = await firstPixel();
  await paletteButton.click();
  const palette = page.getByRole('dialog', { name: '马赛克配色' });
  await palette.getByLabel('自定义颜色').fill('#2070e0');
  await palette.getByRole('button', { name: '应用配色' }).click();
  await expect(paletteButton).toHaveAccessibleName('配色：#2070e0');
  await expect(paletteButton.locator('.palette-dot')).toHaveCSS('background-color', 'rgb(32, 112, 224)');
  const tinted = await firstPixel();
  expect(tinted).not.toEqual(original);
  expect(tinted[2]).toBeGreaterThan(tinted[0]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(await firstPixel()).toEqual(original);
  await page.locator('#masks .mask').first().click();
  await current.press('ArrowDown');
  await expect(current).toHaveAccessibleName('遮挡样式：纯黑');
  await paletteButton.click();
  await palette.getByLabel('自定义颜色').fill('#2070e0');
  await palette.getByRole('button', { name: '应用配色' }).click();
  await page.getByRole('button', { name: '成品预览' }).click();
  const samples = await pixels([[446, 403], [447, 403], [415, 300]]);
  expect(samples[0]).toEqual(samples[1]);
  expect(samples[0]).toEqual(tinted);
  expect(samples[2]).toEqual([0, 0, 0, 255]);
  await page.getByRole('button', { name: '导出当前 PNG' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '仍然导出' }).click();
  const png = await readFile(await (await pending).path());
  expect(await imagePixel(page, png, 446, 403)).toEqual(tinted);
});

test('fine-tunes a base color without changing the preset and can restore it when reopened', async ({ page }) => {
  await openSamples(page);
  const button = page.getByRole('button', { name: /^配色/ });
  const palette = page.getByRole('dialog', { name: '马赛克配色' });
  const bases = palette.getByRole('group', { name: '基础色' }).getByRole('button');
  const cyan = palette.getByRole('button', { name: '青色', exact: true });
  const picker = palette.getByLabel('自定义颜色');
  await button.click();
  await expect(bases).toHaveText(['红色', '橙色', '黄色', '绿色', '青色', '蓝色', '紫色']);
  await expect(palette.getByRole('button', { name: '蓝色' })).toHaveAttribute('aria-pressed', 'true');
  await cyan.click();
  await expect(picker).toHaveValue('#258875');
  await picker.fill('#286b5f');
  await expect(cyan).toHaveAttribute('aria-pressed', 'true');
  await palette.getByRole('button', { name: '应用配色' }).click();
  await expect(button).toHaveAccessibleName('配色：#286b5f');

  await button.click();
  await expect(cyan).toHaveAttribute('aria-pressed', 'true');
  await expect(picker).toHaveValue('#286b5f');
  const restore = palette.getByRole('button', { name: '恢复基础色' });
  await restore.click();
  await expect(picker).toHaveValue('#258875');
  await expect(restore).toBeDisabled();
  await palette.getByRole('button', { name: '应用配色' }).click();
  await expect(button).toHaveAccessibleName('配色：#258875');
});

test('draws consecutive masks and moves and resizes them without switching tools', async ({ page }) => {
  await openSamples(page);
  await page.locator('.file-row').nth(3).click();
  const drawTool = page.getByRole('button', { name: '画遮挡框', exact: true });
  await drawTool.click();
  const drawBox = async (left, top, right, bottom) => {
    const bounds = await page.locator('#artboard').boundingBox();
    return drag(page, imagePoint(bounds, 1120, 700, left, top), imagePoint(bounds, 1120, 700, right, bottom));
  };
  const masks = page.locator('#masks .mask');
  await drawBox(90, 100, 250, 160);
  await drawBox(320, 215, 470, 285);
  await expect(masks).toHaveCount(2);
  await expect(drawTool).toHaveAttribute('aria-pressed', 'true');
  const first = masks.first();
  const before = await first.boundingBox();
  await drawBox(155, 125, 200, 140);
  await expect(masks).toHaveCount(2);
  expect((await first.boundingBox()).x).toBeGreaterThan(before.x + 5);
  const handle = await first.locator('[data-handle="se"]').boundingBox();
  const corner = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await drag(page, corner, { x: corner.x + 24, y: corner.y + 9 });
  expect((await first.boundingBox()).width).toBeGreaterThan(before.width + 10);
  await expect(drawTool).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.down('Alt');
  try { await drawBox(155, 125, 220, 155); }
  finally { await page.keyboard.up('Alt'); }
  await expect(masks).toHaveCount(3);
});

async function imagePixel(page, png, x, y) {
  return page.evaluate(async ({ encoded, x, y }) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d');
    context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    image.close();
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, { encoded: png.toString('base64'), x, y });
}

for (const mosaicFirst of [false, true]) {
  test(`keeps solid masks on top in thumbnails and PNG when ${mosaicFirst ? 'mosaic' : 'solid'} is drawn first`, async ({ page }) => {
    await openSamples(page);
    await page.locator('.file-row').nth(3).click();
    const draw = page.getByRole('button', { name: '画遮挡框', exact: true });
    const wheel = page.locator('#mask-style-current');
    async function drawOnImage(from, to) {
      const bounds = await page.locator('#artboard').boundingBox();
      await drag(page, imagePoint(bounds, 1120, 700, ...from), imagePoint(bounds, 1120, 700, ...to));
    }
    await draw.click();
    if (mosaicFirst) await wheel.press('ArrowUp');
    await drawOnImage([120, 100], [760, 460]);
    await draw.click();
    await wheel.press(mosaicFirst ? 'ArrowDown' : 'ArrowUp');
    await drawOnImage([950, 610], [300, 230]);

    await page.getByRole('button', { name: /^批量应用遮挡/ }).click();
    const map = page.locator('#batch-mask-map');
    const thumbnail = await map.screenshot({ scale: 'css' });
    const { width, height } = await map.boundingBox();
    const black = [0, 0, 0, 255];
    expect(await imagePixel(page, thumbnail, Math.round(width * 580 / 1120), Math.round(height * 380 / 700))).toEqual(black);
    await page.keyboard.press('Escape');

    await page.getByRole('checkbox', { name: '标记为已检查' }).check();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出当前 PNG' }).click();
    const result = await readFile(await (await pending).path());
    expect(await imagePixel(page, result, 580, 380)).toEqual(black);
  });
}

test('coalesces mask dragging and keeps the untouched mosaic canvas in place', async ({ page }) => {
  await openSamples(page);
  const masks = page.locator('#masks .mask');
  await page.locator('#mask-style-current').press('ArrowUp');
  await expect(masks.first().locator('canvas')).toHaveCount(1);
  await page.evaluate(() => {
    window.mosaicDuringDrag = document.querySelector('#masks canvas');
    document.querySelector('#stage').addEventListener('pointerdown', (event) => { window.maskPointer = event.pointerId; }, { once: true });
  });
  const bounds = await masks.nth(1).boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const before = await masks.nth(1).getAttribute('style');
  const state = await page.evaluate(({ x, y }) => {
    const requestFrame = window.requestAnimationFrame;
    const queued = [];
    window.requestAnimationFrame = (callback) => queued.push(callback);
    try {
      const artboard = document.getElementById('artboard');
      for (const dx of [10, 20, 30]) {
        artboard.dispatchEvent(new PointerEvent('pointermove', { pointerId: window.maskPointer, clientX: x + dx, clientY: y, buttons: 1 }));
      }
      const untouched = () => window.mosaicDuringDrag === document.querySelector('#masks canvas');
      const beforeFrame = document.querySelectorAll('#masks .mask')[1].getAttribute('style');
      queued.forEach((frame) => frame());
      return { queued: queued.length, beforeFrame, untouched: untouched() };
    } finally { window.requestAnimationFrame = requestFrame; }
  }, { x, y });
  expect(state).toEqual({ queued: 1, beforeFrame: before, untouched: true });
  const during = await masks.nth(1).boundingBox();
  expect(Math.abs(during.x - bounds.x - 30)).toBeLessThan(1);
  await page.mouse.move(x + 60, y);
  await page.mouse.up();
  const committed = await masks.nth(1).boundingBox();
  expect(Math.abs(committed.x - bounds.x - 60)).toBeLessThan(1);
  const style = await masks.nth(1).getAttribute('style');
  await page.mouse.move(x + 60, y);
  await page.mouse.down();
  await page.mouse.move(x + 82, y);
  await expect(masks.nth(1)).not.toHaveAttribute('style', style);
  await page.locator('#artboard').evaluate((node) => {
    node.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.maskPointer }));
  });
  await page.mouse.up();
  await expect(masks.nth(1)).toHaveAttribute('style', style);
  expect(await page.evaluate(() => window.mosaicDuringDrag === document.querySelector('#masks canvas'))).toBe(true);
});

test('cycles through distinct opaque mosaic textures in the editor and preview', async ({ page }) => {
  await openSamples(page);
  await page.locator('#masks .mask').first().click();
  const current = page.getByRole('button', { name: /^遮挡样式：/ });
  await current.press('ArrowUp');
  const rendered = [];
  for (const name of ['方块马赛克', '柔化', '圆点', '笔刷']) {
    await expect(current).toHaveAccessibleName(`遮挡样式：${name}`);
    await expect(page.locator('#masks .mask canvas')).toHaveCount(1);
    await page.getByRole('button', { name: '成品预览' }).click();
    const data = await page.locator('#preview').evaluate((canvas) =>
      Array.from(canvas.getContext('2d').getImageData(446, 403, 254, 28).data));
    expect(data.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    expect(rendered).not.toContainEqual(data);
    rendered.push(data);
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#masks .mask').first().click();
    await current.press('ArrowUp');
  }
});

test('animates the style reel and swatch in both directions and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSamples(page);
  const wheel = page.locator('#mask-style');
  const turn = (delta) => wheel.evaluate((picker, deltaY) => {
    picker.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true }));
    const reel = picker.querySelector('#mask-style-reel');
    return {
      style: picker.dataset.style,
      labels: [...reel.children].map((row) => row.textContent),
      movement: reel.getAnimations()[0]?.effect.getKeyframes()[0].transform,
      swatch: picker.querySelector('.style-swatch').getAnimations({ subtree: true }).length,
    };
  }, delta);
  const down = await turn(100);
  expect(down).toEqual({ style: 'white', labels: ['方块马赛克', '纯黑', '纯白', '深灰', '笔刷'],
    movement: 'translateY(-50%) translateY(15px)', swatch: 2 });
  const up = await turn(-100);
  expect(up.style).toBe('black');
  expect(up.movement).toBe('translateY(-50%) translateY(-15px)');
  expect(up.swatch).toBe(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const quiet = await turn(100);
  expect(quiet.style).toBe('white');
  expect(quiet.movement).toBeUndefined();
  expect(quiet.swatch).toBe(0);
});

test('highlights the canvas during a drag and reports individual import failures', async ({ page }) => {
  await page.goto('/');
  const transfer = await page.evaluateHandle(() => {
    const items = new DataTransfer();
    items.items.add(new File(['invalid image'], 'wrong-format.webp', { type: 'image/webp' }));
    return items;
  });
  await page.locator('#stage').dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(page.getByText('松开以导入截图')).toBeVisible();
  await page.locator('#stage').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByText('松开以导入截图')).toBeHidden();
  await expect(page.getByText('wrong-format.webp')).toBeVisible();
  await expect(page.getByText('仅支持 PNG 和 JPG', { exact: true })).toBeVisible();
});

test('Space temporarily pans the zoomed canvas without drawing a mask', async ({ page }) => {
  await openSamples(page);
  const draw = page.getByRole('button', { name: '画遮挡框', exact: true });
  await draw.click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '放大', exact: true }).click();
  const stage = page.locator('#stage');
  const area = await stage.boundingBox();
  const from = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const masks = page.locator('#masks .mask');
  const count = await masks.count();
  const before = await stage.evaluate((node) => node.scrollLeft);
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down('Space');
  await drag(page, from, { x: from.x - 80, y: from.y - 30 });
  await page.keyboard.up('Space');
  expect(await stage.evaluate((node) => node.scrollLeft)).toBeGreaterThan(before + 50);
  await expect(masks).toHaveCount(count);
  await expect(draw).toHaveAttribute('aria-pressed', 'true');
  await drag(page, from, { x: from.x - 40, y: from.y - 25 });
  await expect(masks).toHaveCount(count + 1);
});

test('gives toolbar buttons hover and press feedback without moving neighboring targets', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSamples(page);
  const draw = page.getByRole('button', { name: '画遮挡框', exact: true });
  const select = page.getByRole('button', { name: '选择遮挡框', exact: true });
  const disabled = page.getByRole('button', { name: '撤销', exact: true });
  const style = (button, key) => button.evaluate((node, property) => getComputedStyle(node)[property], key);
  const before = await style(draw, 'backgroundColor');
  const neighbor = await select.boundingBox();
  await draw.hover();
  expect(await style(draw, 'backgroundColor')).not.toBe(before);
  const hoverShadow = await style(draw, 'boxShadow');
  await page.mouse.down();
  expect(await style(draw, 'boxShadow')).not.toBe(hoverShadow);
  await page.mouse.up();
  expect(await select.boundingBox()).toEqual(neighbor);
  await expect(disabled).toBeDisabled();
  const disabledBefore = await style(disabled, 'backgroundColor');
  await disabled.hover();
  expect(await style(disabled, 'backgroundColor')).toBe(disabledBefore);
});

test('Ctrl+wheel zooms the screenshot around the pointer while the interface keeps its scale', async ({ page }) => {
  await openSamples(page);
  const artboard = page.locator('#artboard');
  const initial = await artboard.boundingBox();
  const headerWidth = await page.locator('.page-header').evaluate((header) => header.getBoundingClientRect().width);
  const ratio = await page.evaluate(() => devicePixelRatio);
  const start = { x: initial.x + initial.width / 2, y: initial.y + initial.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down('Control');
  try {
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await artboard.boundingBox()).width).toBeGreaterThan(initial.width * 2);
    const enlarged = await artboard.boundingBox();
    const point = { x: start.x + 110, y: start.y + 25 };
    const relative = (bounds) => [(point.x - bounds.x) / bounds.width, (point.y - bounds.y) / bounds.height];
    const before = relative(enlarged);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => (await artboard.boundingBox()).width).toBeLessThan(enlarged.width * .95);
    const after = relative(await artboard.boundingBox());
    expect(after[0]).toBeCloseTo(before[0], 2);
    expect(after[1]).toBeCloseTo(before[1], 2);
  } finally {
    await page.keyboard.up('Control');
  }
  expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
  expect(await page.locator('.page-header').evaluate((header) => header.getBoundingClientRect().width)).toBe(headerWidth);
});

test('organizes imported screenshots and opens a specific unchecked preview from export', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(assets.map((name) => resolve('docs/samples', name)));
  const rows = page.locator('.file-row');
  const button = (name) => page.getByRole('button', { name, exact: true });
  await expect(rows).toHaveCount(3);
  await rows.nth(1).click();
  await button('前移当前截图').click();
  await expect(rows.first()).toContainText('checkout.jpg');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await rows.last().click();
  await button('移除当前截图').click();
  await expect(rows).toHaveCount(2);
  await button('导出全部 ZIP').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'checkout.jpg', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(button('成品预览')).toHaveAttribute('aria-pressed', 'true');
  await button('确认并继续').click();
  await expect(rows.last()).toHaveAttribute('aria-current', 'true');
  await button('确认完成').click();
  await expect(button('下载 ZIP')).toBeFocused();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      HTMLCanvasElement.prototype.toBlob = original;
      window.resumeExport = () => original.apply(this, args);
    };
  });
  const pending = page.waitForEvent('download');
  await button('下载 ZIP').click();
  await expect(page.locator('#operation-progress')).toHaveText('正在导出第 1 / 2 张');
  await expect(button('下载 ZIP')).toBeDisabled();
  await page.evaluate(() => window.resumeExport());
  const zip = unzipSync(await readFile(await (await pending).path()));
  await expect(page.locator('#operation-progress')).toBeHidden();
  expect(Object.keys(zip)).toEqual(['01-redacted.png', '02-redacted.png']);
  const width = (name) => new DataView(zip[name].buffer, zip[name].byteOffset).getUint32(16);
  expect(width('01-redacted.png')).toBe(1024);
  expect(width('02-redacted.png')).toBe(1120);
});

test('starts review from the main workflow and confirms before removing an edited screenshot', async ({ page }) => {
  await openSamples(page);
  const button = (name) => page.getByRole('button', { name, exact: true });
  const rows = page.locator('.file-row');
  await button('移除当前截图').click();
  const prompt = page.getByRole('dialog', { name: '移除截图？' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: '取消' }).click();
  await expect(rows).toHaveCount(demoCount);
  await button('开始检查').click();
  await expect(button('成品预览')).toHaveAttribute('aria-pressed', 'true');
  await button('移除当前截图').click();
  await prompt.getByRole('button', { name: '移除截图' }).click();
  await expect(rows).toHaveCount(demoCount - 1);
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
});

test('opens an empty import workspace and only loads samples on request', async ({ page }) => {
  const sampleRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/samples/')) sampleRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '选择图片' })).toBeVisible();
  await expect(page.locator('.file-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出全部 ZIP' })).toBeDisabled();
  expect(sampleRequests).toEqual([]);
  await page.getByRole('button', { name: '加载虚构示例' }).click();
  await expect(page.locator('.file-row')).toHaveCount(demoCount);
  await page.reload();
  await expect(page.locator('.file-row')).toHaveCount(0);
});

test('displays one image pixel per screen pixel at original size on a high DPI screen', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ deviceScaleFactor: 1.5, viewport: { width: 1440, height: 960 }, baseURL });
  try {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(resolve('docs/samples/account.png'));
    await expect(page.getByRole('heading', { name: 'account.png' })).toBeVisible();
    await page.getByRole('button', { name: '原图大小' }).click();
    const sample = async (selector) => page.locator(selector).evaluate((image) => {
      const bounds = image.getBoundingClientRect();
      return [bounds.width * devicePixelRatio, bounds.height * devicePixelRatio];
    });
    expect((await sample('#source')).map(Math.round)).toEqual([1120, 700]);
    await page.getByRole('button', { name: '成品预览' }).click();
    expect((await sample('#preview')).map(Math.round)).toEqual([1120, 700]);
    expect(await page.locator('#preview').evaluate((canvas) => [canvas.width, canvas.height])).toEqual([1120, 700]);
  } finally {
    await page.close();
  }
});

async function openSamples(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '加载虚构示例' }).click();
  await expect(page.locator('.file-row')).toHaveCount(demoCount);
}
const sampleSizes = [[1120, 700], [1024, 640], [720, 930]];
const sampleMasks = [[446, 403, 700, 431], [67, 341, 295, 375], [429, 540, 625, 736]];

async function fixture(page, index) {
  const width = 520 + 29 * index;
  const height = 310 + 17 * index;
  const mime = index % 2 ? 'image/jpeg' : 'image/png';
  const content = await page.evaluate(({ width, height, index, mime }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = `rgb(${80 + index * 8}, 160, 210)`;
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#551234';
    context.font = '15px sans-serif';
    context.fillText(['demo@example.invalid', 'DEMO-ORDER-1256', 'QR code'][index] ?? 'Tutorial screenshot', 90, 84);
    return canvas.toDataURL(mime).split(',')[1];
  }, { width, height, index, mime });
  return { name: `fixture-${index + 1}.${index % 2 ? 'jpg' : 'png'}`, mimeType: mime, buffer: Buffer.from(content, 'base64') };
}

async function dropFiles(page, files) {
  const transfer = await page.evaluateHandle((entries) => {
    const result = new DataTransfer();
    for (const { name, mimeType, data } of entries) {
      result.items.add(new File([Uint8Array.from(atob(data), (letter) => letter.charCodeAt(0))], name, { type: mimeType }));
    }
    return result;
  }, files.map(({ name, mimeType, buffer }) => ({ name, mimeType, data: buffer.toString('base64') })));
  await page.locator('body').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
}

function imagePoint(box, width, height, x, y) {
  return { x: box.x + x / width * box.width, y: box.y + y / height * box.height };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function inspectDownload(page, entries, fixtures, previews, probePoints) {
  return page.evaluate(async ({ entries, fixtures, previews, probePoints }) => {
    async function pixels(data, type) {
      const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), (letter) => letter.charCodeAt(0))], { type }));
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    const results = [];
    for (const [index, entry] of entries.entries()) {
      const output = await pixels(entry, 'image/png');
      const source = await pixels(fixtures[index].data, fixtures[index].mime);
      const preview = await pixels(previews[index], 'image/png');
      let black = 0;
      let exact = output.data.length === preview.data.length;
      let outsideDifference = 0;
      for (let offset = 0; offset < output.data.length; offset += 4) {
        const covered = output.data[offset] === 0 && output.data[offset + 1] === 0 && output.data[offset + 2] === 0 && output.data[offset + 3] === 255;
        black += Number(covered);
        for (let channel = offset; channel < offset + 4; channel++) {
          exact &&= output.data[channel] === preview.data[channel];
          if (!covered && output.data[channel] !== source.data[channel]) outsideDifference++;
        }
      }
      const [x, y] = probePoints[index] ?? [0, 0];
      const targetOffset = (y * output.width + x) * 4;
      results.push({ width: output.width, height: output.height, black, exact, outsideDifference, target: Array.from(output.data.slice(targetOffset, targetOffset + 4)) });
    }
    return results;
  }, { entries, fixtures: fixtures.map((file) => ({ data: file.buffer.toString('base64'), mime: file.mimeType })), previews, probePoints });
}

test('reviews ten mixed images and exports original dimensions and exact preview pixels in order', async ({ page }) => {
  const outsideRequests = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4173/')) outsideRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('.file-row')).toHaveCount(0);
  const fixtures = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const name = assets[index];
    if (!name) return fixture(page, index);
    return { name, mimeType: name.endsWith('.jpg') ? 'image/jpeg' : 'image/png', buffer: await readFile(resolve('docs/samples', name)) };
  }));
  await dropFiles(page, fixtures);
  await expect(page.locator('.file-row')).toHaveCount(10);
  await page.getByRole('button', { name: '导出全部 ZIP' }).click();
  await expect(page.getByRole('dialog').locator('li')).toHaveCount(10);
  await page.getByRole('button', { name: '逐张检查' }).click();
  await expect(page.getByRole('button', { name: '成品预览' })).toHaveAttribute('aria-pressed', 'true');

  const previews = [];
  for (let index = 0; index < 10; index++) {
    await page.locator('.file-row').nth(index).click();
    if (index < 3) {
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      await page.getByRole('button', { name: '画遮挡框' }).click();
      const bounds = await page.locator('#artboard').boundingBox();
      const [width, height] = sampleSizes[index];
      const [left, top, right, bottom] = sampleMasks[index];
      await drag(page, imagePoint(bounds, width, height, left, top), imagePoint(bounds, width, height, right, bottom));
      await expect(page.locator('.mask')).toHaveCount(1);
    }
    await page.getByRole('button', { name: '成品预览' }).click();
    previews.push(await page.locator('#preview').evaluate((canvas) => canvas.toDataURL().split(',')[1]));
    await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  }
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部 ZIP' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('screenshots-redacted.zip');
  const files = unzipSync(await readFile(await download.path()));
  expect(Object.keys(files)).toEqual(Array.from({ length: 10 }, (_, index) => `${String(index + 1).padStart(2, '0')}-redacted.png`));
  const results = await inspectDownload(page, Object.values(files).map((data) => Buffer.from(data).toString('base64')), fixtures, previews,
    [[490, 415], [125, 353], [525, 635]]);
  for (const [index, output] of results.entries()) {
    expect([output.width, output.height]).toEqual(sampleSizes[index] ?? [520 + 29 * index, 310 + 17 * index]);
    expect(output.exact).toBe(true);
    expect(output.outsideDifference, `Image ${index + 1}`).toBe(0);
    if (index < 3) {
      expect(output.black).toBeGreaterThan(6500);
      expect(output.target).toEqual([0, 0, 0, 255]);
    } else {
      expect(output.black).toBe(0);
    }
  }
  expect(outsideRequests).toEqual([]);
});

test('moves and resizes at high zoom, restores edits independently, and reopens review', async ({ page }) => {
  await openSamples(page);
  await page.locator('#file-input').setInputFiles(assets.slice(0, 2).map((name) => resolve('docs/samples', name)));
  await expect(page.locator('.file-row')).toHaveCount(2);
  const current = page.getByRole('checkbox', { name: '标记为已检查' });
  await current.check();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  const artboard = await page.locator('#artboard').boundingBox();
  await drag(page, { x: artboard.x + 130, y: artboard.y + 110 }, { x: artboard.x + 280, y: artboard.y + 150 });
  await expect(current).not.toBeChecked();
  const mask = page.locator('.mask');
  const initial = await mask.getAttribute('style');
  const bounds = await mask.boundingBox();
  await drag(page, { x: bounds.x + 70, y: bounds.y + 20 }, { x: bounds.x + 102, y: bounds.y + 48 });
  expect(await mask.getAttribute('style')).not.toBe(initial);
  const moved = await mask.getAttribute('style');
  const corner = await page.locator('[data-handle="se"]').boundingBox();
  await drag(page, { x: corner.x + 5, y: corner.y + 5 }, { x: corner.x + 49, y: corner.y + 30 });
  const resized = await mask.getAttribute('style');
  expect(resized).not.toBe(moved);
  await page.locator('.file-row').nth(1).click();
  await expect(mask).toHaveCount(0);
  await page.locator('.file-row').nth(0).click();
  await expect(mask).toHaveAttribute('style', resized);
  await mask.click();
  await page.getByRole('button', { name: '删除遮挡' }).click();
  await expect(mask).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(mask).toHaveAttribute('style', resized);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(mask).toHaveAttribute('style', moved);
});

test('pastes a screenshot and downloads the individual flattened PNG', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.file-row')).toHaveCount(0);
  await page.evaluate(async () => {
    const data = new DataTransfer();
    data.items.add(new File([await (await fetch('./samples/receipt.png')).blob()], 'pasted.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.file-row')).toHaveCount(1);
  await expect(page.locator('.file-row').first()).toContainText('pasted.png');
  await page.getByRole('button', { name: '导出当前 PNG' }).click();
  await expect(page.getByRole('dialog').locator('li')).toHaveCount(1);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '仍然导出' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('01-redacted.png');
  const file = await readFile(await download.path());
  expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});

test('rejects animated PNG so editing and export cannot show different frames', async ({ page }) => {
  await openSamples(page);
  const animated = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAADAAAAAwAAAAAAAAAAAAEABAAAjNOqugAAABFJREFUeJxj/M8ABUwwBhILAB1bAQXoN6jFAAAAGmZjVEwAAAABAAAAAwAAAAMAAAAAAAAAAAABAAQAABegQG4AAAAXZmRBVAAAAAJ4nGNkYPjPAAZMEAqFBQAbXQEFbkuO+wAAAABJRU5ErkJggg==';
  await page.locator('#file-input').setInputFiles({ name: 'animated.png', mimeType: 'image/png', buffer: Buffer.from(animated, 'base64') });
  await expect(page.getByText('暂不支持动态 PNG', { exact: true })).toBeVisible();
  await expect(page.locator('.file-row')).toHaveCount(demoCount);
});

test('copies a selected mask to chosen same-size screenshots and exports it independently', async ({ page }) => {
  await page.goto('/');
  const original = await readFile(resolve('docs/samples/account.png'));
  const png = (name) => ({ name, mimeType: 'image/png', buffer: original });
  await page.locator('#file-input').setInputFiles([png('source.png'), png('chosen.png'), png('skip.png'), png('also-chosen.png'), {
    name: 'different.jpg', mimeType: 'image/jpeg', buffer: await readFile(resolve('docs/samples/checkout.jpg')),
  }]);
  const rows = page.locator('.file-row');
  const mask = page.locator('.mask');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText('source.png');
  await rows.nth(1).click();
  await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  await rows.nth(0).click();
  const bounds = await page.locator('#artboard').boundingBox();
  await drag(page, imagePoint(bounds, 1120, 700, 446, 403), imagePoint(bounds, 1120, 700, 700, 431));
  const originalStyle = await mask.getAttribute('style');
  const open = page.getByRole('button', { name: '批量应用遮挡' });
  await expect(open).toHaveText(/3 张可选/);
  await open.click();
  const picker = page.getByRole('dialog', { name: '批量应用遮挡框' });
  await expect(picker.locator('#batch-targets li').last()).toContainText('different.jpg');
  await expect(picker.getByRole('checkbox', { name: /different\.jpg/ })).toBeDisabled();
  await expect(picker.getByRole('checkbox', { name: /source\.png/ })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: '应用到 0 张' })).toBeDisabled();
  await picker.getByRole('checkbox', { name: '全选可应用截图' }).check();
  await picker.getByRole('checkbox', { name: /skip\.png/ }).uncheck();
  await picker.getByRole('button', { name: '应用到 2 张' }).click();
  await expect(picker).toBeHidden();
  await expect(rows.nth(1)).toContainText('待检查');
  await expect(rows.nth(1)).toContainText('1 处遮挡');
  await expect(rows.nth(2)).not.toContainText('处遮挡');
  await expect(rows.nth(3)).toContainText('1 处遮挡');
  await expect(open).toHaveText(/1 张可选/);
  await open.click();
  await expect(picker.getByRole('checkbox', { name: /^chosen\.png/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await rows.nth(1).click();
  await expect(mask).toHaveAttribute('style', originalStyle);
  await mask.click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(mask).not.toHaveAttribute('style', originalStyle);
  await rows.nth(0).click();
  await expect(mask).toHaveAttribute('style', originalStyle);
  await rows.nth(3).click();
  await expect(mask).toHaveAttribute('style', originalStyle);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(mask).toHaveCount(0);

  await page.getByRole('button', { name: '导出全部 ZIP' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '仍然导出' }).click();
  const zip = unzipSync(await readFile(await (await pending).path()));
  const colors = await page.evaluate(async (images) => {
    const result = [];
    for (const bytes of images) {
      const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      result.push([...context.getImageData(490, 415, 1, 1).data]);
      image.close();
    }
    return result;
  }, ['01', '02', '03', '04'].map((number) => Array.from(zip[`${number}-redacted.png`])));
  expect(colors.slice(0, 2)).toEqual([[0, 0, 0, 255], [0, 0, 0, 255]]);
  expect(colors[2]).not.toEqual([0, 0, 0, 255]);
  expect(colors[3]).toEqual(colors[2]);
});

test('confirms a preview and jumps to the next unreviewed image across the end of the list', async ({ page }) => {
  await openSamples(page);
  const rows = page.locator('.file-row');
  await expect(rows).toHaveCount(demoCount);
  const check = page.getByRole('checkbox', { name: '标记为已检查' });
  await rows.nth(2).click();
  await check.check();
  await rows.nth(3).click();
  await check.check();
  await rows.nth(1).click();
  await page.getByRole('button', { name: '成品预览' }).click();
  const next = page.getByRole('button', { name: '确认并继续' });
  await next.click();
  await expect(rows.nth(1)).toContainText('已检查');
  await expect(rows.nth(4)).toHaveAttribute('aria-current', 'true');
  await next.click();
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: '确认完成' }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(demoCount));
  await expect(page.getByRole('button', { name: '下载 ZIP', exact: true })).toBeFocused();
});

test('keeps preview actions visible on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openSamples(page);
  await page.getByRole('button', { name: '成品预览' }).click();
  await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  const footer = await page.locator('.editor-foot').evaluate(({ scrollWidth, clientWidth }) => ({ scrollWidth, clientWidth }));
  expect(footer.scrollWidth).toBeLessThanOrEqual(footer.clientWidth);
  await expect(page.getByRole('button', { name: '导出当前 PNG' })).toBeInViewport({ ratio: 1 });
});

test('keeps the next review action in view on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await openSamples(page);
  await page.getByRole('button', { name: '开始检查' }).click();
  const next = page.getByRole('button', { name: '确认并继续' });
  await expect(next).toBeInViewport({ ratio: 1 });
  await next.click();
  await expect(page.locator('.file-row').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(next).toBeInViewport({ ratio: 1 });
});

test('pauses export and batch actions while an import is still being read', async ({ page }) => {
  await openSamples(page);
  await page.evaluate(() => {
    const nativeRead = Blob.prototype.arrayBuffer;
    const gate = new Promise((resolve) => { window.resumeFileRead = resolve; });
    Blob.prototype.arrayBuffer = async function () {
      await gate;
      return nativeRead.call(this);
    };
  });
  await page.locator('#file-input').setInputFiles(resolve('docs/samples/account.png'));
  const progress = page.locator('#operation-progress');
  await expect(progress).toHaveText('正在读取第 1 / 1 张');
  await expect(page.getByRole('button', { name: '导出全部 ZIP' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '批量应用遮挡' })).toBeDisabled();
  await page.evaluate(() => window.resumeFileRead());
  await expect(page.locator('.file-row')).toHaveCount(1);
  await expect(progress).toBeHidden();
  await expect(page.getByRole('button', { name: '导出全部 ZIP' })).toBeEnabled();
});

test('navigates the thumbnail list by keyboard with focus following the current image', async ({ page }) => {
  await openSamples(page);
  const rows = page.locator('.file-row');
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(rows.first()).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('End');
  await expect(rows.last()).toBeFocused();
  await expect(rows.last()).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Home');
  await page.keyboard.press('s');
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
});

test('navigates and starts drawing with left-hand shortcuts in edit and preview', async ({ page }) => {
  await openSamples(page);
  const rows = page.locator('.file-row');
  const previous = page.getByRole('button', { name: '上一张', exact: true });
  const next = page.getByRole('button', { name: '下一张', exact: true });
  const draw = page.getByRole('button', { name: '画遮挡框', exact: true });
  const preview = page.getByRole('button', { name: '成品预览' });
  await expect(rows).toHaveCount(demoCount);
  await expect(previous).toBeDisabled();
  await page.keyboard.press('w');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('s');
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await preview.click();
  await page.keyboard.press('s');
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await previous.click();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await next.click();
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('r');
  await expect(draw).toHaveAttribute('aria-pressed', 'true');
  await rows.last().click();
  await expect(next).toBeDisabled();
  await page.keyboard.press('s');
  await expect(rows.last()).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: '导出全部 ZIP' }).click();
  await page.keyboard.press('w');
  await page.keyboard.press('Escape');
  await expect(rows.last()).toHaveAttribute('aria-current', 'true');
});

test('applies multiple chosen masks to nine screenshots and undoes the batch while preserving independent edits', async ({ page }) => {
  await page.goto('/');
  const original = await readFile(resolve('docs/samples/account.png'));
  await page.locator('#file-input').setInputFiles(Array.from({ length: 10 }, (_, index) => ({
    name: `screen-${index + 1}.png`, mimeType: 'image/png', buffer: original,
  })));
  const rows = page.locator('.file-row');
  const masks = page.locator('.mask');
  const draw = async (left, top, right, bottom) => {
    await page.keyboard.press('r');
    const bounds = await page.locator('#artboard').boundingBox();
    await drag(page, imagePoint(bounds, 1120, 700, left, top), imagePoint(bounds, 1120, 700, right, bottom));
  };
  await expect(rows).toHaveCount(10);
  await rows.nth(1).click();
  await draw(446, 403, 700, 431);
  await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  await rows.first().click();
  await draw(446, 403, 700, 431);
  await draw(378, 277, 480, 317);
  await draw(440, 475, 530, 510);
  await expect(masks).toHaveCount(3);
  const open = page.getByRole('button', { name: '批量应用遮挡' });
  await open.click();
  const picker = page.getByRole('dialog', { name: '批量应用遮挡框' });
  await picker.getByRole('checkbox', { name: '全选可应用截图' }).check();
  const maskChoices = await picker.getByRole('list', { name: '遮挡框' }).getByRole('checkbox').all();
  for (const choice of maskChoices) await choice.uncheck();
  await expect(picker.getByRole('button', { name: '应用到 0 张' })).toBeDisabled();
  await maskChoices[0].check();
  await maskChoices[1].check();
  await picker.getByRole('button', { name: '应用到 9 张' }).click();
  await expect(rows.first()).toContainText('3 处遮挡');
  for (const row of (await rows.all()).slice(1)) await expect(row).toContainText('待检查 · 2 处遮挡');

  const readPreview = async (points) => {
    await page.getByRole('button', { name: '成品预览' }).click();
    return page.locator('#preview').evaluate((canvas, coords) => coords.map(([x, y]) =>
      [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]), points);
  };
  await rows.last().click();
  const pixels = await readPreview([[490, 415], [400, 300], [460, 491]]);
  expect(pixels.slice(0, 2)).toEqual([[0, 0, 0, 255], [0, 0, 0, 255]]);
  expect(pixels[2]).not.toEqual([0, 0, 0, 255]);

  await rows.nth(1).click();
  await draw(80, 500, 175, 540);
  await masks.nth(1).click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(masks).toHaveCount(3);
  await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  await page.getByRole('button', { name: '撤销最近一次批量应用' }).click();
  await expect(rows.nth(1)).toContainText('待检查 · 2 处遮挡');
  await expect(rows.last()).not.toContainText('处遮挡');
  await expect(masks).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(masks).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(masks).toHaveCount(0);
});

test('E confirms one preview per keypress and skips checked images', async ({ page }) => {
  await openSamples(page);
  const rows = page.locator('.file-row');
  await expect(rows).toHaveCount(demoCount);
  await page.keyboard.press('e');
  await expect(rows.first()).toContainText('待检查');
  await rows.nth(1).click();
  await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  await rows.first().click();
  await page.getByRole('button', { name: '成品预览' }).click();
  await page.keyboard.down('e');
  await page.keyboard.down('e');
  await page.keyboard.up('e');
  await expect(rows.first()).toContainText('已检查');
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(2)).toContainText('待检查');
  await page.keyboard.press('e');
  await expect(rows.nth(3)).toHaveAttribute('aria-current', 'true');
});

test('mosaicTile uses only 1x1 averageBoxColor with deterministic PRNG to prevent Depix recovery', async ({ page }) => {
  await page.goto('/');
  const equal = await page.evaluate(async () => {
    const { mosaicTile } = await import('/images.mjs?v=0.2.1');
    const makeCanvasImage = (draw) => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      draw(ctx);
      return canvas;
    };
    const split = makeCanvasImage((ctx) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 80, 80);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(80, 0, 80, 80);
    });
    const checker = makeCanvasImage((ctx) => {
      for (let y = 0; y < 80; y++) {
        for (let x = 0; x < 160; x++) {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#000000' : '#ffffff';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });
    const results = {};
    for (const style of ['mosaic', 'soft', 'dots', 'brush']) {
      const box = { x: 0, y: 0, width: 160, height: 80, style };
      const first = mosaicTile(split, box);
      const second = mosaicTile(checker, box);
      const a = first.getContext('2d').getImageData(0, 0, first.width, first.height).data;
      const b = second.getContext('2d').getImageData(0, 0, second.width, second.height).data;
      results[style] = a.length === b.length && a.every((value, idx) => value === b[idx]);
    }
    return results;
  });
  expect(equal).toEqual({ mosaic: true, soft: true, dots: true, brush: true });
});

test('warns about textured masks in footer and export dialog and converts them to solid black', async ({ page }) => {
  await openSamples(page);
  const masks = page.locator('#masks .mask');
  await masks.first().click();
  await page.locator('#mask-style-current').press('ArrowUp');
  await expect(masks.first().locator('canvas')).toHaveCount(1);

  const footerWarning = page.locator('#texture-warning');
  await expect(footerWarning).toBeVisible();
  await expect(footerWarning).toContainText('有 1 处使用纹理遮挡');

  await page.getByRole('button', { name: '导出全部 ZIP' }).click();
  const exportDialog = page.getByRole('dialog');
  const dialogWarning = exportDialog.locator('#export-texture-warning');
  await expect(dialogWarning).toBeVisible();
  await expect(dialogWarning).toContainText('有 1 处使用纹理遮挡');

  await dialogWarning.getByRole('button', { name: '一键改为纯色（纯黑）' }).click();
  await expect(dialogWarning).toBeHidden();
  await expect(footerWarning).toBeHidden();
  await exportDialog.getByRole('button', { name: '关闭' }).click();

  await expect(masks.first().locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(masks.first().locator('canvas')).toHaveCount(1);
  await expect(footerWarning).toBeVisible();

  await footerWarning.getByRole('button', { name: '一键改为纯色（纯黑）' }).click();
  await expect(footerWarning).toBeHidden();
  await expect(masks.first().locator('canvas')).toHaveCount(0);
});

test('tracks hasUnexportedChanges with beforeunload and resets after single or batch export', async ({ page }) => {
  await page.goto('/');
  const checkBeforeUnload = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(await checkBeforeUnload()).toBe(false);
  await page.locator('#file-input').setInputFiles(resolve('docs/samples/account.png'));
  await expect(page.locator('.file-row')).toHaveCount(1);
  expect(await checkBeforeUnload()).toBe(true);

  await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  const singleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前 PNG' }).click();
  await singleDownload;
  expect(await checkBeforeUnload()).toBe(false);

  const bounds = await page.locator('#artboard').boundingBox();
  await drag(page, imagePoint(bounds, 1120, 700, 100, 100), imagePoint(bounds, 1120, 700, 220, 150));
  expect(await checkBeforeUnload()).toBe(true);

  await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  const batchDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部 ZIP' }).click();
  await batchDownload;
  expect(await checkBeforeUnload()).toBe(false);
});

test('reuses 180px thumbUrl in sidebar, batch mask map, and batch targets', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: await readFile(resolve('docs/samples/account.png')) },
    { name: 'two.png', mimeType: 'image/png', buffer: await readFile(resolve('docs/samples/account-team.png')) },
  ]);
  await expect(page.locator('.file-row')).toHaveCount(2);

  const sidebarThumbs = await page.locator('.file-row .thumb').evaluateAll((imgs) =>
    imgs.map((img) => ({ src: img.src, width: img.naturalWidth, height: img.naturalHeight })));
  expect(sidebarThumbs[0].src.startsWith('blob:')).toBe(true);
  expect(Math.max(sidebarThumbs[0].width, sidebarThumbs[0].height)).toBeLessThanOrEqual(180);

  const bounds = await page.locator('#artboard').boundingBox();
  await drag(page, imagePoint(bounds, 1120, 700, 120, 120), imagePoint(bounds, 1120, 700, 280, 180));
  await page.getByRole('button', { name: /^批量应用遮挡/ }).click();

  const mapSrc = await page.locator('#batch-mask-map img').getAttribute('src');
  const targetSrc = await page.locator('#batch-targets .thumb').first().getAttribute('src');
  expect(mapSrc).toBe(sidebarThumbs[0].src);
  expect(targetSrc).toBe(sidebarThumbs[1].src);
});

test('streams ZIP export via showSaveFilePicker when available and preserves dirty state on cancel', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    window.__streamedExports = [];
    window.__cancelPicker = false;
    window.showSaveFilePicker = async (options) => {
      if (window.__cancelPicker) throw new DOMException('Aborted', 'AbortError');
      const chunks = [];
      return {
        async createWritable() {
          return {
            async write(chunk) {
              const bytes = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : new Uint8Array(chunk);
              chunks.push(Array.from(bytes));
            },
            async close() {
              window.__streamedExports.push({ name: options.suggestedName, chunks });
            },
            async abort() {},
          };
        },
      };
    };
  });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: await readFile(resolve('docs/samples/account.png')) },
    { name: 'b.png', mimeType: 'image/png', buffer: await readFile(resolve('docs/samples/checkout.jpg')) },
  ]);
  for (let i = 0; i < 2; i++) {
    await page.locator('.file-row').nth(i).click();
    await page.getByRole('checkbox', { name: '标记为已检查' }).check();
  }

  await page.evaluate(() => { window.__cancelPicker = true; });
  await page.getByRole('button', { name: '导出全部 ZIP' }).click();
  await expect(page.locator('#toast')).toBeHidden();
  expect(await page.evaluate(() => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  })).toBe(true);

  await page.evaluate(() => { window.__cancelPicker = false; });
  await page.getByRole('button', { name: '导出全部 ZIP' }).click();
  await expect.poll(async () => page.evaluate(() => window.__streamedExports.length)).toBe(1);
  const exported = await page.evaluate(() => window.__streamedExports[0]);
  expect(exported.name).toBe('screenshots-redacted.zip');
  expect(exported.chunks.length).toBeGreaterThan(2);
  const merged = new Uint8Array(exported.chunks.flat());
  const zip = unzipSync(merged);
  expect(Object.keys(zip)).toEqual(['01-redacted.png', '02-redacted.png']);
});

test('reuses mosaic canvas during drag, updates tileKey after drop/arrow nudge, and records mosaicBase undo', async ({ page }) => {
  await openSamples(page);
  const mask = page.locator('#masks .mask').first();
  await mask.click();
  await page.locator('#mask-style-current').press('ArrowUp');
  const canvas = mask.locator('canvas');
  await expect(canvas).toHaveCount(1);
  const initialKey = await canvas.getAttribute('data-tile-key');
  expect(initialKey).toMatch(/^mosaic::446,403:254x28$/);

  // Drag the mosaic mask itself: canvas node stays reused during move, then updates tileKey on pointerup.
  await page.evaluate(() => {
    window.__draggedCanvas = document.querySelector('#masks .mask canvas');
    window.__moveSawSameCanvas = true;
    const observer = new MutationObserver(() => {
      if (document.querySelector('#masks .mask canvas') !== window.__draggedCanvas) {
        window.__moveSawSameCanvas = false;
      }
    });
    observer.observe(document.querySelector('#masks'), { childList: true, subtree: true });
    window.__stopObserver = () => observer.disconnect();
  });
  const bounds = await mask.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2 + 20, { steps: 4 });
  expect(await page.evaluate(() => {
    window.__stopObserver();
    return window.__moveSawSameCanvas;
  })).toBe(true);
  await page.mouse.up();
  const droppedKey = await mask.locator('canvas').getAttribute('data-tile-key');
  expect(droppedKey).not.toBe(initialKey);

  // Arrow keys move 1px and Shift+Arrow moves 10px, updating tileKey.
  await page.keyboard.press('ArrowRight');
  const nudged1px = await mask.locator('canvas').getAttribute('data-tile-key');
  const [, , posBefore, size] = droppedKey.split(':');
  const [bx, by] = posBefore.split(',').map(Number);
  expect(nudged1px).toBe(`mosaic::${bx + 1},${by}:${size}`);
  await page.keyboard.press('Shift+ArrowDown');
  const nudged10px = await mask.locator('canvas').getAttribute('data-tile-key');
  expect(nudged10px).toBe(`mosaic::${bx + 1},${by + 10}:${size}`);

  // Changing mosaicBase via palette preset is recorded in undo stack even if mosaicTint is customized back/changed.
  await page.getByRole('button', { name: /^配色/ }).click();
  const palette = page.getByRole('dialog', { name: '马赛克配色' });
  await palette.getByRole('button', { name: '红色', exact: true }).click();
  await palette.getByRole('button', { name: '应用配色' }).click();
  await expect(page.getByRole('button', { name: '配色：#d43b35' })).toBeVisible();
  // Change only mosaicBase (keep custom tint #d43b35 while switching base preset to 蓝色 then restoring tint)
  // Actually test selecting green preset then changing color back to #d43b35 so ONLY mosaicBase differs!
  await page.getByRole('button', { name: /^配色/ }).click();
  await palette.getByRole('button', { name: '绿色', exact: true }).click();
  await palette.getByLabel('自定义颜色').fill('#d43b35');
  await palette.getByRole('button', { name: '应用配色' }).click();

  // Undo should restore mosaicBase to red (#d43b35).
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await mask.click();
  await page.getByRole('button', { name: /^配色/ }).click();
  await expect(palette.getByRole('button', { name: '红色', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await palette.getByRole('button', { name: '关闭' }).click();
});

