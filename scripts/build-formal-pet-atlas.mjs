import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

/**
 * 将初始美术条带拆为 256px 单元格并组装为正式图集。
 * 该脚本保留在 v1 素材流程中；当前 30fps 图集使用 rebuild-pet-atlas-30fps.mjs。
 */
const root = process.cwd();
const decodedRoot = path.join(root, 'work', 'pet-v1', 'decoded');
const framesRoot = path.join(root, 'work', 'pet-v1', 'frames');
const finalRoot = path.join(root, 'work', 'pet-v1', 'final');

const cellSize = 256;
const columns = 16;
const actions = [
  {name: 'idle', sourceFrames: 6, loop: true},
  {name: 'look-left', sourceFrames: 4, loop: true},
  {name: 'look-right', sourceFrames: 4, loop: true},
  {name: 'click-reaction', sourceFrames: 6, loop: false},
  {name: 'drag-left', sourceFrames: 8, loop: true},
  {name: 'drag-right', sourceFrames: 8, loop: true},
  {name: 'dock-left-enter', sourceFrames: 6, loop: false},
  {name: 'dock-left-idle', sourceFrames: 6, loop: true},
  {name: 'dock-right-enter', sourceFrames: 6, loop: false},
  {name: 'dock-right-idle', sourceFrames: 6, loop: true},
];

const visibleBounds = (data, info, left, width) => {
  let minX = width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const alpha = data[(y * info.width + left + localX) * info.channels + 3];
      if (alpha <= 16) continue;
      minX = Math.min(minX, localX);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, localX);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) throw new Error(`No visible pixels in slot at x=${left}`);
  return {left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX + 1, height: maxY - minY + 1};
};

const cleanDetachedFragments = async (input) => {
  // 仅保留主角色及紧邻的有效部件，清理生成图中偶发的孤立像素/碎片。
  const {data, info} = await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const pixelCount = info.width * info.height;
  const visited = new Uint8Array(pixelCount);
  const components = [];
  const stack = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || data[start * info.channels + 3] <= 16) continue;
    visited[start] = 1;
    stack.push(start);
    const pixels = [];
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;

    while (stack.length > 0) {
      const index = stack.pop();
      pixels.push(index);
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [index - 1, index + 1, index - info.width, index + info.width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= pixelCount || visited[neighbor]) continue;
        const neighborX = neighbor % info.width;
        if (Math.abs(neighborX - x) > 1) continue;
        if (data[neighbor * info.channels + 3] <= 16) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }

    components.push({pixels, minX, minY, maxX, maxY});
  }

  components.sort((a, b) => b.pixels.length - a.pixels.length);
  const main = components[0];
  if (!main) return input;
  const distanceToMain = (component) => {
    const dx = Math.max(main.minX - component.maxX, component.minX - main.maxX, 0);
    const dy = Math.max(main.minY - component.maxY, component.minY - main.maxY, 0);
    return Math.hypot(dx, dy);
  };
  const minimumArea = Math.max(96, Math.round(main.pixels.length * 0.003));
  const keep = new Set(
    components
      .filter((component, index) => index === 0 || (component.pixels.length >= minimumArea && distanceToMain(component) <= 8))
      .flatMap((component) => component.pixels),
  );

  for (let index = 0; index < pixelCount; index += 1) {
    if (keep.has(index)) continue;
    const offset = index * info.channels;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  return sharp(data, {raw: info}).png().toBuffer();
};

await mkdir(framesRoot, {recursive: true});
await mkdir(finalRoot, {recursive: true});

const atlasComposites = [];
const qaComposites = [];
const qaScale = 0.5;
const qaCell = cellSize * qaScale;
const qaLabelWidth = 210;

for (let row = 0; row < actions.length; row += 1) {
  const action = actions[row];
  const sourcePath = path.join(decodedRoot, `${action.name}.png`);
  const image = sharp(sourcePath).ensureAlpha();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Missing dimensions for ${sourcePath}`);
  const {data, info} = await image.raw().toBuffer({resolveWithObject: true});

  const slots = Array.from({length: action.sourceFrames}, (_, frame) => {
    const left = Math.floor((frame * info.width) / action.sourceFrames);
    const right = Math.floor(((frame + 1) * info.width) / action.sourceFrames);
    const width = right - left;
    return {left, width, bounds: visibleBounds(data, info, left, width)};
  });

  const horizontalPadding = 16;
  const verticalPadding = 14;
  const cropWidth = Math.min(
    Math.min(...slots.map((slot) => slot.width)),
    Math.max(...slots.map((slot) => slot.bounds.width)) + horizontalPadding * 2,
  );
  const cropTop = Math.max(0, Math.min(...slots.map((slot) => slot.bounds.top)) - verticalPadding);
  const cropBottom = Math.min(info.height - 1, Math.max(...slots.map((slot) => slot.bounds.bottom)) + verticalPadding);
  const cropHeight = cropBottom - cropTop + 1;
  const outputDir = path.join(framesRoot, action.name);
  await rm(outputDir, {recursive: true, force: true});
  await mkdir(outputDir, {recursive: true});

  const sourceBuffers = [];

  for (let frame = 0; frame < slots.length; frame += 1) {
    const slot = slots[frame];
    const centerX = slot.left + (slot.bounds.left + slot.bounds.right) / 2;
    const minimumLeft = slot.left;
    const maximumLeft = slot.left + slot.width - cropWidth;
    const cropLeft = Math.round(Math.max(minimumLeft, Math.min(maximumLeft, centerX - cropWidth / 2)));
    const resizedFrame = await sharp(sourcePath)
      .ensureAlpha()
      .extract({left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight})
      .resize(236, 236, {
        fit: 'contain',
        position: 'centre',
        background: {r: 0, g: 0, b: 0, alpha: 0},
        kernel: sharp.kernel.lanczos3,
      })
      .extend({top: 10, bottom: 10, left: 10, right: 10, background: {r: 0, g: 0, b: 0, alpha: 0}})
      .png()
      .toBuffer();
    const frameBuffer = await cleanDetachedFragments(resizedFrame);
    sourceBuffers.push(frameBuffer);
  }

  const outputBuffers = [];
  for (let frame = 0; frame < sourceBuffers.length; frame += 1) {
    // 历史图集将源帧复制一份以填充双倍帧数；新流程改为真正的 30fps 时序。
    const current = sourceBuffers[frame];
    outputBuffers.push(current, current);
  }

  for (let frame = 0; frame < outputBuffers.length; frame += 1) {
    const frameBuffer = outputBuffers[frame];
    const outputPath = path.join(outputDir, `${String(frame).padStart(2, '0')}.png`);
    await writeFile(outputPath, frameBuffer);
    atlasComposites.push({input: frameBuffer, left: frame * cellSize, top: row * cellSize});

    const qaBuffer = await sharp(frameBuffer)
      .resize(Math.round(qaCell), Math.round(qaCell))
      .png()
      .toBuffer();
    qaComposites.push({input: qaBuffer, left: qaLabelWidth + frame * qaCell, top: row * qaCell});
  }

  console.log(`${action.name}: ${action.sourceFrames} source frames -> ${outputBuffers.length} output frames, crop ${cropWidth}x${cropHeight}`);
}

const atlas = sharp({
  create: {
    width: columns * cellSize,
    height: actions.length * cellSize,
    channels: 4,
    background: {r: 0, g: 0, b: 0, alpha: 0},
  },
}).composite(atlasComposites);

await atlas.clone().png().toFile(path.join(finalRoot, 'atlas.png'));
await atlas.clone().webp({lossless: true, effort: 6}).toFile(path.join(finalRoot, 'atlas.webp'));

// contact sheet 仅供人工检查身份、基线、裁切和帧数，不参与运行时加载。
const qaWidth = qaLabelWidth + columns * qaCell;
const qaHeight = actions.length * qaCell;
const labels = actions
  .map((action, row) => {
    const y = row * qaCell;
    return `<rect x="0" y="${y}" width="${qaWidth}" height="${qaCell}" fill="${row % 2 === 0 ? '#e6e7e9' : '#d8dade'}"/>` +
      `<text x="18" y="${y + 70}" font-family="Arial, sans-serif" font-size="20" fill="#202329">${action.name}</text>` +
      `<text x="18" y="${y + 94}" font-family="Arial, sans-serif" font-size="14" fill="#5a606b">${action.sourceFrames * 2} frames</text>`;
  })
  .join('');
const qaBackground = Buffer.from(`<svg width="${qaWidth}" height="${qaHeight}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`);
await sharp(qaBackground).composite(qaComposites).png().toFile(path.join(finalRoot, 'contact-sheet.png'));

console.log(`Wrote ${path.relative(root, path.join(finalRoot, 'atlas.webp'))}`);
console.log(`Wrote ${path.relative(root, path.join(finalRoot, 'contact-sheet.png'))}`);
