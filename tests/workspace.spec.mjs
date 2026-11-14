import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

const assets = ['account.png', 'checkout.jpg', 'receipt.png'];
const demoCount = 5;

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
  await button('确认并继续').click();
  const pending = page.waitForEvent('download');
  await button('导出全部 ZIP').click();
  const zip = unzipSync(await readFile(await (await pending).path()));
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
  await expect(page.getByRole('status')).toContainText('动态 PNG');
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
  await open.click();
  const picker = page.getByRole('dialog', { name: '批量应用遮挡框' });
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
  await next.click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(demoCount));
  await expect(page.getByRole('status')).toContainText('已检查全部');
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
  await page.getByRole('button', { name: '成品预览' }).click();
  const next = page.getByRole('button', { name: '确认并继续' });
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
  await expect(page.getByRole('button', { name: '导出全部 ZIP' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '批量应用遮挡' })).toBeDisabled();
  await page.evaluate(() => window.resumeFileRead());
  await expect(page.locator('.file-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '导出全部 ZIP' })).toBeEnabled();
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
