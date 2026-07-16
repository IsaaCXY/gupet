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
  if (!Number.isInteger(animation.frames) || animation.frames < 1 || animation.frames > 96) throw new Error(`${name}: invalid frame count`);
  if (!Array.isArray(animation.durationsMs) || animation.durationsMs.length !== animation.frames) {
    throw new Error(`${name}: durationsMs must contain one duration per frame`);
  }
  if (animation.reducedMotionFrame < 0 || animation.reducedMotionFrame >= animation.frames) {
    throw new Error(`${name}: reducedMotionFrame is outside the used frames`);
  }
  maximumRow = Math.max(maximumRow, animation.row + Math.ceil(animation.frames / manifest.cell.columns) - 1);
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
const cellForFrame = (animation, frame) => ({
  row: animation.row + Math.floor(frame / manifest.cell.columns),
  column: frame % manifest.cell.columns,
});
const visibleBounds = (animation, frame) => {
  const {row, column} = cellForFrame(animation, frame);
  let left = manifest.cell.width;
  let right = -1;
  for (let y = 0; y < manifest.cell.height; y += 1) {
    for (let x = 0; x < manifest.cell.width; x += 1) {
      if (alphaAt(column * manifest.cell.width + x, row * manifest.cell.height + y) < manifest.hitTest.alphaThreshold) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (right < left) throw new Error(`Empty frame at row ${row}, column ${column}`);
  return {left, right};
};
const owners = new Map();
for (const [name, animation] of Object.entries(manifest.animations)) {
  for (let frame = 0; frame < animation.frames; frame += 1) {
    const {row, column} = cellForFrame(animation, frame);
    const key = `${row}:${column}`;
    if (owners.has(key)) throw new Error(`${name}: frame ${frame} overlaps ${owners.get(key)}`);
    owners.set(key, `${name}:${frame}`);
  }
}
for (let row = 0; row <= maximumRow; row += 1) {
  for (let column = 0; column < manifest.cell.columns; column += 1) {
    const owner = owners.get(`${row}:${column}`);
    let hasVisiblePixel = false;
    const startX = column * manifest.cell.width;
    const startY = row * manifest.cell.height;
    for (let y = startY; y < startY + manifest.cell.height && !hasVisiblePixel; y += 1) {
      for (let x = startX; x < startX + manifest.cell.width; x += 1) {
        if (alphaAt(x, y) !== 0) {
          hasVisiblePixel = true;
          break;
        }
      }
    }
    if (owner && !hasVisiblePixel) throw new Error(`${owner} is empty`);
    if (!owner && hasVisiblePixel) throw new Error(`unused cell ${row}:${column} is not transparent`);
  }
}

for (const side of ['Left', 'Right']) {
  // 原始边缘待机有 5px 内的毛绒轮廓摆动；超过该范围才会造成可见的吸边跳动。
  const edgeTolerance = 6;
  const enter = manifest.animations[manifest.bindings[`dock${side}Enter`]];
  const idle = manifest.animations[manifest.bindings[`dock${side}Idle`]];
  const edge = side === 'Left' ? 'left' : 'right';
  const expected = visibleBounds(idle, 0)[edge];
  for (let frame = 0; frame < idle.frames; frame += 1) {
    if (Math.abs(visibleBounds(idle, frame)[edge] - expected) > edgeTolerance) {
      throw new Error(`dock${side}Idle frame ${frame} exceeds its ${edge} edge tolerance`);
    }
  }
  if (Math.abs(visibleBounds(enter, enter.frames - 1)[edge] - expected) > edgeTolerance) {
    throw new Error(`dock${side}Enter final frame exceeds its ${edge} edge tolerance`);
  }
}

console.log(`Validated ${manifest.id}: ${metadata.width}x${metadata.height}, ${Object.keys(manifest.animations).length} animations`);
