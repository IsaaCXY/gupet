import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

/**
 * 视觉稳定性校验：检查所有动作的 30fps 时序、可见高度、脚部基线和 idle 循环边界。
 * 像素级约束补足 manifest 结构校验无法发现的视觉跳变。
 */
const root = process.cwd();
const petRoot = path.join(root, 'public', 'pets', 'default');
const manifest = JSON.parse(await readFile(path.join(petRoot, 'pet.json'), 'utf8'));
const atlasPath = path.join(petRoot, 'atlas.webp');
const expectedDuration = 1000 / 30;
const tolerance = 0.001;
const {data, info} = await sharp(atlasPath).ensureAlpha().raw().toBuffer({resolveWithObject: true});
const cell = manifest.cell.width;

const offset = (x, y) => (y * info.width + x) * info.channels;
const frameCell = (animation, frame) => ({
  row: animation.row + Math.floor(frame / manifest.cell.columns),
  column: frame % manifest.cell.columns,
});
const bounds = (animation, frame) => {
  const {row, column} = frameCell(animation, frame);
  let left = cell;
  let top = cell;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      if (data[offset(column * cell + x, row * cell + y) + 3] < manifest.hitTest.alphaThreshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error(`Empty frame ${row}:${frame}`);
  return {left, top, right, bottom, height: bottom - top + 1};
};

const framesVisuallyEqual = (animation, firstFrame, secondFrame) => {
  const firstCell = frameCell(animation, firstFrame);
  const secondCell = frameCell(animation, secondFrame);
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const first = offset(firstCell.column * cell + x, firstCell.row * cell + y);
      const second = offset(secondCell.column * cell + x, secondCell.row * cell + y);
      const firstAlpha = data[first + 3];
      const secondAlpha = data[second + 3];
      if (firstAlpha !== secondAlpha) return false;
      // WebP 可能在完全透明像素保留不同 RGB；这不会影响实际循环画面。
      if (firstAlpha >= manifest.hitTest.alphaThreshold &&
        (data[first] !== data[second] || data[first + 1] !== data[second + 1] || data[first + 2] !== data[second + 2])) return false;
    }
  }
  return true;
};

const allBounds = [];
for (const [name, animation] of Object.entries(manifest.animations)) {
  if (animation.durationsMs.some((duration) => Math.abs(duration - expectedDuration) > tolerance)) {
    throw new Error(`${name} is not configured for 30fps`);
  }
  const actionBounds = Array.from({length: animation.frames}, (_, frame) => bounds(animation, frame));
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

// 首尾字节完全一致才能保证 idle 从末帧回到首帧时无缝。
const idle = manifest.animations[manifest.bindings.idle];
if (idle.frames < 2) throw new Error('Idle must contain a complete action sequence');
if (!framesVisuallyEqual(idle, 0, idle.frames - 1)) {
  throw new Error('Idle loop boundary is not visually identical');
}

console.log(`Validated 30fps timing, fixed baseline, and uniform scale for ${Object.keys(manifest.animations).length} animations`);
