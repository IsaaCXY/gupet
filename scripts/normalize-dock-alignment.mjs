import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

/**
 * 将停靠进入动画的最后一帧与停靠待机各帧的 alpha 边缘对齐。
 * 窗口位置以可见角色边缘计算，若资源帧不齐会在边缘产生横向跳动。
 */
const root = process.cwd();
const petRoot = path.join(root, 'public', 'pets', 'default');
const manifest = JSON.parse(await readFile(path.join(petRoot, 'pet.json'), 'utf8'));
const atlasPath = path.join(petRoot, path.basename(manifest.atlasPath));
const threshold = manifest.hitTest.alphaThreshold;
const {data, info} = await sharp(atlasPath).ensureAlpha().raw().toBuffer({resolveWithObject: true});
const cell = manifest.cell.width;

const frameBounds = (row, frame) => {
  let left = cell;
  let right = -1;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      if (data[((row * cell + y) * info.width + frame * cell + x) * info.channels + 3] < threshold) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (right < left) throw new Error(`Empty dock frame at row ${row}, frame ${frame}`);
  return {left, right};
};

const shiftFrame = (row, frame, delta) => {
  if (delta === 0) return;
  const source = Buffer.alloc(cell * cell * info.channels);
  // 先拷出单元格再平移，避免原地写入时覆盖尚未读取的像素。
  for (let y = 0; y < cell; y += 1) {
    const start = ((row * cell + y) * info.width + frame * cell) * info.channels;
    data.copy(source, y * cell * info.channels, start, start + cell * info.channels);
  }
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const alpha = source[(y * cell + x) * info.channels + 3];
      if (alpha !== 0 && (x + delta < 0 || x + delta >= cell)) {
        throw new Error(`Dock alignment would crop row ${row}, frame ${frame}`);
      }
    }
  }
  for (let y = 0; y < cell; y += 1) {
    const start = ((row * cell + y) * info.width + frame * cell) * info.channels;
    data.fill(0, start, start + cell * info.channels);
  }
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const destinationX = x + delta;
      if (destinationX < 0 || destinationX >= cell) continue;
      const sourceOffset = (y * cell + x) * info.channels;
      const destinationOffset = ((row * cell + y) * info.width + frame * cell + destinationX) * info.channels;
      source.copy(data, destinationOffset, sourceOffset, sourceOffset + info.channels);
    }
  }
};

const alignSide = (side) => {
  // 待机第 0 帧作为锚点；进入动画的尾帧必须无缝衔接到该锚点。
  const enter = manifest.animations[manifest.bindings[`dock${side}Enter`]];
  const idle = manifest.animations[manifest.bindings[`dock${side}Idle`]];
  const edge = side === 'Left' ? 'left' : 'right';
  const target = frameBounds(idle.row, 0)[edge];

  for (let frame = 0; frame < idle.frames; frame += 1) {
    shiftFrame(idle.row, frame, target - frameBounds(idle.row, frame)[edge]);
  }
  const finalFrame = enter.frames - 1;
  shiftFrame(enter.row, finalFrame, target - frameBounds(enter.row, finalFrame)[edge]);
};

alignSide('Left');
alignSide('Right');
await sharp(data, {raw: info}).webp({lossless: true, effort: 6}).toFile(atlasPath);
console.log(`Normalized dock alignment in ${path.relative(root, atlasPath)}`);
