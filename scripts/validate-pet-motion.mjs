import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const root = process.cwd();
const petRoot = path.join(root, 'public', 'pets', 'default');
const manifest = JSON.parse(await readFile(path.join(petRoot, 'pet.json'), 'utf8'));
const atlasPath = path.join(petRoot, 'atlas.webp');
const expectedDuration = 1000 / 30;
const tolerance = 0.001;
const {data, info} = await sharp(atlasPath).ensureAlpha().raw().toBuffer({resolveWithObject: true});
const cell = manifest.cell.width;

const offset = (x, y) => (y * info.width + x) * info.channels;
const bounds = (row, frame) => {
  let left = cell;
  let top = cell;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      if (data[offset(frame * cell + x, row * cell + y) + 3] < manifest.hitTest.alphaThreshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error(`Empty frame ${row}:${frame}`);
  return {left, top, right, bottom, height: bottom - top + 1};
};

const frameBytes = (row, frame) => {
  const output = Buffer.alloc(cell * cell * info.channels);
  for (let y = 0; y < cell; y += 1) {
    const start = offset(frame * cell, row * cell + y);
    data.copy(output, y * cell * info.channels, start, start + cell * info.channels);
  }
  return output;
};

const allBounds = [];
for (const [name, animation] of Object.entries(manifest.animations)) {
  if (animation.durationsMs.some((duration) => Math.abs(duration - expectedDuration) > tolerance)) {
    throw new Error(`${name} is not configured for 30fps`);
  }
  const actionBounds = Array.from({length: animation.frames}, (_, frame) => bounds(animation.row, frame));
  const heights = actionBounds.map((item) => item.height);
  const bottoms = actionBounds.map((item) => item.bottom);
  if (Math.max(...heights) - Math.min(...heights) > 1) throw new Error(`${name} changes character scale between frames`);
  if (Math.max(...bottoms) - Math.min(...bottoms) > 1) throw new Error(`${name} changes its feet baseline between frames`);
  allBounds.push(...actionBounds);
}

const allHeights = allBounds.map((item) => item.height);
const allBottoms = allBounds.map((item) => item.bottom);
if (Math.max(...allHeights) - Math.min(...allHeights) > 1) throw new Error('Character scale changes between animations');
if (Math.max(...allBottoms) - Math.min(...allBottoms) > 1) throw new Error('Feet baseline changes between animations');

const idle = manifest.animations[manifest.bindings.idle];
if (idle.frames !== 16) throw new Error('Idle must use 16 frames at 30fps');
if (!frameBytes(idle.row, 0).equals(frameBytes(idle.row, idle.frames - 1))) {
  throw new Error('Idle loop boundary is not pixel-identical');
}

console.log(`Validated 30fps timing, fixed baseline, and uniform scale for ${Object.keys(manifest.animations).length} animations`);
