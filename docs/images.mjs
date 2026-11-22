import { outputName } from './geometry.mjs?v=0.2.2';

export const maskColors = Object.freeze({ black: '#000', white: '#fff', gray: '#484b52' });
const mosaicStyles = new Set(['mosaic', 'brush', 'dots', 'soft']);
export const isMosaic = (style) => mosaicStyles.has(style);

export function averageBoxColor(image, box) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  try {
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, 1, 1);
    if (box.mosaicTint) {
      context.globalAlpha = 0.62;
      context.fillStyle = box.mosaicTint;
      context.fillRect(0, 0, 1, 1);
      context.globalAlpha = 1;
    }
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function createPrng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedForBox(box) {
  let hash = 2166136261;
  const text = `${box.style ?? 'mosaic'}:${box.x},${box.y}:${box.width}x${box.height}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const clampByte = (value) => Math.min(255, Math.max(0, Math.round(value)));

export function mosaicTile(image, box) {
  const [r, g, b] = averageBoxColor(image, box);
  const rand = createPrng(seedForBox(box));
  const rgb = (dr, dg = dr, db = dr) => `rgb(${clampByte(r + dr)} ${clampByte(g + dg)} ${clampByte(b + db)})`;
  const cellSize = box.style === 'brush' || box.style === 'dots'
    ? Math.max(16, Math.ceil(Math.max(box.width, box.height) / 128)) : 16;
  const cols = Math.max(1, Math.floor(box.width / cellSize));
  const rows = Math.max(1, Math.floor(box.height / cellSize));

  if (box.style !== 'brush' && box.style !== 'dots') {
    const tile = document.createElement('canvas');
    tile.width = cols;
    tile.height = rows;
    const context = tile.getContext('2d', { alpha: false });
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const luma = (rand() - 0.5) * 44;
        context.fillStyle = rgb(
          luma + (rand() - 0.5) * 8,
          luma + (rand() - 0.5) * 8,
          luma + (rand() - 0.5) * 8,
        );
        context.fillRect(x, y, 1, 1);
      }
    }
    return tile;
  }

  const pattern = document.createElement('canvas');
  const cell = 8;
  pattern.width = cols * cell;
  pattern.height = rows * cell;
  const paint = pattern.getContext('2d', { alpha: false });
  paint.imageSmoothingEnabled = false;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const shift = (rand() - 0.5) * 32;
      const left = x * cell;
      const top = y * cell;
      if (box.style === 'dots') {
        paint.fillStyle = rgb(shift + 24);
        paint.fillRect(left, top, cell, cell);
        paint.fillStyle = rgb(shift - 22);
        paint.beginPath();
        paint.arc(left + 4, top + 4, 3.2 + rand() * 0.7, 0, Math.PI * 2);
        paint.fill();
      } else {
        paint.fillStyle = rgb(shift);
        paint.fillRect(left, top, cell, cell);
        paint.fillStyle = rgb(shift + 18);
        paint.fillRect(left + Math.floor(rand() * 3), top + 1, cell - 2, 1);
        paint.fillStyle = rgb(shift - 22);
        paint.fillRect(left, top + 3 + Math.floor(rand() * 2), cell - Math.floor(rand() * 2), 2);
        paint.fillStyle = rgb(shift - 12);
        paint.fillRect(left + Math.floor(rand() * 2), top + 7, cell - 2, 1);
      }
    }
  }
  return pattern;
}

export function thumbnailSize(sourceWidth, sourceHeight) {
  const scale = Math.min(1, 180 / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export async function createThumbnailUrl(image) {
  const { width, height } = thumbnailSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建缩略图画布');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('无法生成缩略图'));
      }, 'image/png');
    });
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
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

export function drawFlattened(canvas, entry, { width, height } = entry) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布');
  context.scale(width / entry.width, height / entry.height);
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

async function streamBatchToWritable(entries, writable, progress) {
  const zip = new globalThis.fflate.Zip();
  let writeChain = Promise.resolve();
  let zipError;
  zip.ondata = (error, data) => {
    if (error) {
      zipError = zipError ?? error;
      return;
    }
    writeChain = writeChain.then(() => writable.write(data)).catch((err) => {
      zipError = zipError ?? err;
    });
  };
  try {
    for (const [index, entry] of entries.entries()) {
      progress(index + 1, entries.length);
      const png = await encodePNG(entry);
      const file = new globalThis.fflate.ZipPassThrough(outputName(index, entries.length));
      zip.add(file);
      file.push(new Uint8Array(await png.arrayBuffer()), true);
      await writeChain;
      if (zipError) throw zipError;
    }
    zip.end();
    await writeChain;
    if (zipError) throw zipError;
    await writable.close();
  } catch (error) {
    zip.terminate();
    await writable.abort(error).catch(() => {});
    throw error;
  }
}

export async function exportImages(entries, batch, filename, progress) {
  if (!navigator.webdriver && typeof globalThis.showSaveFilePicker === 'function') {
    const handle = await globalThis.showSaveFilePicker({
      suggestedName: filename,
      types: batch
        ? [{ description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }]
        : [{ description: 'PNG 图片', accept: { 'image/png': ['.png'] } }],
    });
    const writable = await handle.createWritable();
    if (batch) {
      await streamBatchToWritable(entries, writable, progress);
      return;
    }
    try {
      const png = await encodePNG(entries[0]);
      await writable.write(png);
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => {});
      throw error;
    }
    return;
  }

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
