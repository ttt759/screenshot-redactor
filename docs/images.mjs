import { outputName } from './geometry.mjs';

export const maskColors = Object.freeze({ black: '#000', white: '#fff', gray: '#484b52' });

export function mosaicTile(image, box) {
  const tile = document.createElement('canvas');
  tile.width = Math.max(1, Math.floor(box.width / 16));
  tile.height = Math.max(1, Math.floor(box.height / 16));
  const sample = tile.getContext('2d', { alpha: false });
  sample.imageSmoothingQuality = 'high';
  sample.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, tile.width, tile.height);
  return tile;
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
    if (box.style !== 'mosaic') continue;
    context.imageSmoothingEnabled = false;
    context.drawImage(mosaicTile(entry.image, box), box.x, box.y, box.width, box.height);
  }
  for (const box of entry.boxes) {
    if (box.style === 'mosaic') continue;
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
