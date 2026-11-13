import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

const assets = ['account.png', 'checkout.jpg', 'receipt.png'];
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
  await expect(page.locator('.file-row')).toHaveCount(3);
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
  await page.goto('/');
  await expect(page.locator('.file-row')).toHaveCount(3);
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
  await expect(page.locator('.file-row')).toHaveCount(3);
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
  await page.goto('/');
  await expect(page.locator('.file-row')).toHaveCount(3);
  const animated = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAADAAAAAwAAAAAAAAAAAAEABAAAjNOqugAAABFJREFUeJxj/M8ABUwwBhILAB1bAQXoN6jFAAAAGmZjVEwAAAABAAAAAwAAAAMAAAAAAAAAAAABAAQAABegQG4AAAAXZmRBVAAAAAJ4nGNkYPjPAAZMEAqFBQAbXQEFbkuO+wAAAABJRU5ErkJggg==';
  await page.locator('#file-input').setInputFiles({ name: 'animated.png', mimeType: 'image/png', buffer: Buffer.from(animated, 'base64') });
  await expect(page.getByRole('status')).toContainText('动态 PNG');
  await expect(page.locator('.file-row')).toHaveCount(3);
});
