import { outputName } from './geometry.mjs';

export const maskColors = Object.freeze({ black: '#000', white: '#fff', gray: '#484b52' });
const mosaicStyles = new Set(['mosaic', 'brush', 'dots', 'soft']);
export const isMosaic = (style) => mosaicStyles.has(style);

export function mosaicTile(image, box) {
  const tile = document.createElement('canvas');
  const cellSize = box.style === 'brush' || box.style === 'dots'
    ? Math.max(16, Math.ceil(Math.max(box.width, box.height) / 128)) : 16;
  tile.width = Math.max(1, Math.floor(box.width / cellSize));
  tile.height = Math.max(1, Math.floor(box.height / cellSize));
  const sample = tile.getContext('2d', { alpha: false });
  sample.imageSmoothingQuality = 'high';
  sample.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, tile.width, tile.height);
  if (box.mosaicTint) {
    sample.globalAlpha = .62;
    sample.fillStyle = box.mosaicTint;
    sample.fillRect(0, 0, tile.width, tile.height);
    sample.globalAlpha = 1;
  }
  if (box.style !== 'brush' && box.style !== 'dots') return tile;

  const pixels = sample.getImageData(0, 0, tile.width, tile.height).data;
  const pattern = document.createElement('canvas');
  const cell = 8;
  pattern.width = tile.width * cell;
  pattern.height = tile.height * cell;
  const paint = pattern.getContext('2d', { alpha: false });
  paint.imageSmoothingEnabled = false;
  paint.drawImage(tile, 0, 0, pattern.width, pattern.height);
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      const i = (y * tile.width + x) * 4;
      const color = (offset) => `rgb(${[0, 1, 2].map((channel) => Math.min(255, Math.max(0, pixels[i + channel] + offset))).join(' ')})`;
      const left = x * cell, top = y * cell;
      if (box.style === 'dots') {
        paint.fillStyle = color(24);
        paint.fillRect(left, top, cell, cell);
        paint.fillStyle = color(-22);
        paint.beginPath();
        paint.arc(left + 4, top + 4, 3.6, 0, Math.PI * 2);
        paint.fill();
      } else {
        paint.fillStyle = color(18);
        paint.fillRect(left + (x + y) % 3, top + 1, cell - 2, 1);
        paint.fillStyle = color(-22);
        paint.fillRect(left, top + 3 + (x + y) % 2, cell - x % 2, 2);
        paint.fillStyle = color(-12);
        paint.fillRect(left + y % 2, top + 7, cell - 2, 1);
      }
    }
  }
  return pattern;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取图片'));
    image.src = url;
  });
}

async function isAnimatedPNG(file) {
  // In APNG, the animation control chunk precedes the first image data chunk.
  let offset = 8;
  while (offset + 12 <= file.size) {
    const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
    const type = header.getUint32(4);
    if (type === 0x6163544c) return true; // acTL
    if (type === 0x49444154 || type === 0x49454e44) return false; // IDAT or IEND
    offset += header.getUint32(0) + 12;
  }
  return false;
}

export async function loadFile(file) {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (!png && !jpeg) throw new Error('仅支持 PNG 和 JPG');
  if (png && await isAnimatedPNG(file)) throw new Error('暂不支持动态 PNG');
  const url = URL.createObjectURL(file);
  try {
    return { url, image: await loadImage(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function drawFlattened(canvas, entry) {
  canvas.width = entry.width;
  canvas.height = entry.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布');
  context.drawImage(entry.image, 0, 0);
  // Apply mosaic first so a solid mask always wins in overlapping regions.
  for (const box of entry.boxes) {
    if (!isMosaic(box.style)) continue;
    context.imageSmoothingEnabled = box.style === 'soft';
    context.drawImage(mosaicTile(entry.image, box), box.x, box.y, box.width, box.height);
  }
  for (const box of entry.boxes) {
    if (isMosaic(box.style)) continue;
    context.fillStyle = maskColors[box.style] ?? maskColors.black;
    context.fillRect(box.x, box.y, box.width, box.height);
  }
}

async function encodePNG(entry) {
  const canvas = document.createElement('canvas');
  try {
    drawFlattened(canvas, entry);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('无法生成 PNG'));
      }, 'image/png');
    });
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function encodeBatch(entries, progress) {
  const zip = new globalThis.fflate.Zip();
  const chunks = [];
  let zipError;
  zip.ondata = (error, data) => {
    if (error) zipError = error;
    else chunks.push(data);
  };
  try {
    for (const [index, entry] of entries.entries()) {
      progress(index + 1, entries.length);
      const png = await encodePNG(entry);
      const file = new globalThis.fflate.ZipPassThrough(outputName(index, entries.length));
      zip.add(file);
      file.push(new Uint8Array(await png.arrayBuffer()), true);
      if (zipError) throw zipError;
    }
    zip.end();
    if (zipError) throw zipError;
    return new Blob(chunks, { type: 'application/zip' });
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

export async function exportImages(entries, batch, filename, progress) {
  const blob = batch ? await encodeBatch(entries, progress) : await encodePNG(entries[0]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
