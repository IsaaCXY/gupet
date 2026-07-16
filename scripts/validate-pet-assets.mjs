import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

/**
 * 结构校验：确保 manifest、图集维度、已用/未用单元格和停靠边缘约束一致。
 * 此脚本在 start/package/make 前运行，阻止损坏素材进入应用。
 */
const manifestPath = path.join(process.cwd(), 'public', 'pets', 'default', 'pet.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const atlasPath = path.join(process.cwd(), 'public', 'pets', 'default', path.basename(manifest.atlasPath));

if (manifest.schemaVersion !== 1) throw new Error('Unsupported pet schemaVersion');
if (manifest.cell?.width !== 256 || manifest.cell?.height !== 256 || manifest.cell?.columns !== 32) {
  throw new Error('Pet atlas must use 32 columns of 256x256 cells');
}

const bindings = Object.entries(manifest.bindings ?? {});
for (const [binding, animationName] of bindings) {
  if (!manifest.animations?.[animationName]) throw new Error(`Binding ${binding} references missing animation ${animationName}`);
}

let maximumRow = -1;
for (const [name, animation] of Object.entries(manifest.animations ?? {})) {
  if (!Number.isInteger(animation.row) || animation.row < 0) throw new Error(`${name}: invalid row`);
  if (!Number.isInteger(animation.frames) || animation.frames < 1 || animation.frames > manifest.cell.columns) throw new Error(`${name}: invalid frame count`);
  if (!Array.isArray(animation.durationsMs) || animation.durationsMs.length !== animation.frames) {
    throw new Error(`${name}: durationsMs must contain one duration per frame`);
  }
  if (animation.reducedMotionFrame < 0 || animation.reducedMotionFrame >= animation.frames) {
    throw new Error(`${name}: reducedMotionFrame is outside the used frames`);
  }
  maximumRow = Math.max(maximumRow, animation.row);
}

const image = sharp(atlasPath);
const metadata = await image.metadata();
const expectedWidth = manifest.cell.width * manifest.cell.columns;
const expectedHeight = manifest.cell.height * (maximumRow + 1);
if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
  throw new Error(`Atlas is ${metadata.width}x${metadata.height}; expected ${expectedWidth}x${expectedHeight}`);
}
if (!metadata.hasAlpha) throw new Error('Atlas must contain an alpha channel');

const {data, info} = await image.ensureAlpha().raw().toBuffer({resolveWithObject: true});
const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
const visibleBounds = (row, frame) => {
  let left = manifest.cell.width;
  let right = -1;
  for (let y = 0; y < manifest.cell.height; y += 1) {
    for (let x = 0; x < manifest.cell.width; x += 1) {
      if (alphaAt(frame * manifest.cell.width + x, row * manifest.cell.height + y) < manifest.hitTest.alphaThreshold) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (right < left) throw new Error(`Empty frame at row ${row}, frame ${frame}`);
  return {left, right};
};
for (const [name, animation] of Object.entries(manifest.animations)) {
  for (let frame = 0; frame < manifest.cell.columns; frame += 1) {
    let hasVisiblePixel = false;
    const startX = frame * manifest.cell.width;
    const startY = animation.row * manifest.cell.height;
    for (let y = startY; y < startY + manifest.cell.height && !hasVisiblePixel; y += 1) {
      for (let x = startX; x < startX + manifest.cell.width; x += 1) {
        if (alphaAt(x, y) !== 0) {
          hasVisiblePixel = true;
          break;
        }
      }
    }
    if (frame < animation.frames && !hasVisiblePixel) throw new Error(`${name}: used frame ${frame} is empty`);
    if (frame >= animation.frames && hasVisiblePixel) throw new Error(`${name}: unused frame ${frame} is not transparent`);
  }
}

for (const side of ['Left', 'Right']) {
  // 进入动作尾帧和边缘待机必须使用同一可见边缘，否则吸边完成后会跳动。
  const enter = manifest.animations[manifest.bindings[`dock${side}Enter`]];
  const idle = manifest.animations[manifest.bindings[`dock${side}Idle`]];
  const edge = side === 'Left' ? 'left' : 'right';
  const expected = visibleBounds(idle.row, 0)[edge];
  for (let frame = 0; frame < idle.frames; frame += 1) {
    if (visibleBounds(idle.row, frame)[edge] !== expected) {
      throw new Error(`dock${side}Idle frame ${frame} must keep its ${edge} edge aligned`);
    }
  }
  if (visibleBounds(enter.row, enter.frames - 1)[edge] !== expected) {
    throw new Error(`dock${side}Enter final frame must align with dock${side}Idle frame 0`);
  }
}

console.log(`Validated ${manifest.id}: ${metadata.width}x${metadata.height}, ${Object.keys(manifest.animations).length} animations`);
