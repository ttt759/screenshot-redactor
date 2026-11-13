import assert from 'node:assert/strict';
import test from 'node:test';
import { moveBox, pixelBounds, resizeBox, outputName } from '../docs/geometry.mjs';

const image = { width: 100, height: 80 };
const box = { x: 15, y: 20, width: 32, height: 18 };

test('drawing toward the top left clamps to the image and rounds outward', () => {
  assert.deepEqual(pixelBounds({ x: 45.1, y: 32.9 }, { x: -3, y: 12.8 }, image),
    { x: 0, y: 12, width: 46, height: 21 });
});

test('moving against an edge preserves dimensions', () => {
  assert.deepEqual(moveBox(box, 80, -40, image), { x: 68, y: 0, width: 32, height: 18 });
});

test('resizing keeps the opposite corner fixed and a nonempty area', () => {
  assert.deepEqual(resizeBox(box, 'nw', 90, 4, image), { x: 46, y: 24, width: 1, height: 14 });
  assert.deepEqual(resizeBox(box, 'se', 200, 200, image), { x: 15, y: 20, width: 85, height: 60 });
});

test('filenames preserve the image sequence across three-digit batches', () => {
  assert.equal(outputName(0, 10), '01-redacted.png');
  assert.equal(outputName(9, 10), '10-redacted.png');
  assert.equal(outputName(8, 110), '009-redacted.png');
});
