export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function pixelBounds(start, end, image) {
  const left = clamp(Math.floor(Math.min(start.x, end.x)), 0, image.width);
  const top = clamp(Math.floor(Math.min(start.y, end.y)), 0, image.height);
  const right = clamp(Math.ceil(Math.max(start.x, end.x)), 0, image.width);
  const bottom = clamp(Math.ceil(Math.max(start.y, end.y)), 0, image.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function moveBox(box, dx, dy, image) {
  return {
    ...box,
    x: clamp(box.x + Math.round(dx), 0, image.width - box.width),
    y: clamp(box.y + Math.round(dy), 0, image.height - box.height),
  };
}

export function resizeBox(box, corner, dx, dy, image) {
  let { x, y } = box;
  let right = x + box.width;
  let bottom = y + box.height;
  if (corner.includes('w')) x = clamp(x + Math.round(dx), 0, right - 1);
  if (corner.includes('e')) right = clamp(right + Math.round(dx), x + 1, image.width);
  if (corner.includes('n')) y = clamp(y + Math.round(dy), 0, bottom - 1);
  if (corner.includes('s')) bottom = clamp(bottom + Math.round(dy), y + 1, image.height);
  return { ...box, x, y, width: right - x, height: bottom - y };
}

export function outputName(index, total) {
  const digits = Math.max(2, String(total).length);
  return `${String(index + 1).padStart(digits, '0')}-redacted.png`;
}
