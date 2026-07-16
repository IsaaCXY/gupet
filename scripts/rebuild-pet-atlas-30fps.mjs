import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

/**
 * 当前正式图集重建流程：将三段 idle 源条带和已有动作统一到固定高度、脚部基线与 30fps。
 * 输出直接写入 public，归一化后的逐帧 PNG 与边界报告只保留在 work/ 供 QA 使用。
 */
const root = process.cwd();
const petRoot = path.join(root, 'public', 'pets', 'default');
const sourceAtlasPath = path.join(petRoot, 'atlas.webp');
const manifestPath = path.join(petRoot, 'pet.json');
const idleStripPaths = [
  path.join(root, 'assets', 'pets', 'default', 'idle-3s-part-01-alpha.png'),
  path.join(root, 'assets', 'pets', 'default', 'idle-3s-part-02-alpha.png'),
  path.join(root, 'assets', 'pets', 'default', 'idle-3s-part-03-alpha.png'),
];
const normalizedRoot = path.join(root, 'work', 'pet-v2', 'normalized');
const qaRoot = path.join(root, 'work', 'pet-v2', 'qa');

const CELL = 256;
const COLUMNS = 32;
const IDLE_FRAMES = 90;
// 运行时使用浮点毫秒值精确表达 30fps，而不是近似的 33ms。
const FRAME_DURATION_MS = 1000 / 30;
const ALPHA_THRESHOLD = 16;
const TARGET_VISIBLE_HEIGHT = 224;
const BASELINE_Y = 239;

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
// 图集宽度与 manifest 必须同步升级，否则 Renderer 会按旧列数解释资源。
manifest.cell.columns = COLUMNS;
const {data: atlasData, info: atlasInfo} = await sharp(sourceAtlasPath).ensureAlpha().raw().toBuffer({resolveWithObject: true});
const idleSheets = await Promise.all(idleStripPaths.map(async (idleStripPath) => {
  const sheet = await sharp(idleStripPath).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  if (sheet.info.width < 30 || sheet.info.height < 1) throw new Error(`Idle strip is too small: ${idleStripPath}`);
  return sheet;
}));

const pixelOffset = (info, x, y) => (y * info.width + x) * info.channels;

const connectedIdleSlots = ({data: idleData, info: idleInfo}, label) => {
  // 每段 idle 源图都是 2×15 排列。按 4 邻域找完整角色组件，避免假设每个槽等宽。
  const pixels = idleInfo.width * idleInfo.height;
  const visited = new Uint8Array(pixels);
  const components = [];
  const stack = [];

  for (let start = 0; start < pixels; start += 1) {
    if (visited[start] || idleData[start * idleInfo.channels + 3] < ALPHA_THRESHOLD) continue;
    visited[start] = 1;
    stack.push(start);
    let left = idleInfo.width;
    let top = idleInfo.height;
    let right = -1;
    let bottom = -1;
    let area = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      const x = index % idleInfo.width;
      const y = Math.floor(index / idleInfo.width);
      area += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (const neighbor of [index - 1, index + 1, index - idleInfo.width, index + idleInfo.width]) {
        if (neighbor < 0 || neighbor >= pixels || visited[neighbor]) continue;
        const neighborX = neighbor % idleInfo.width;
        if (Math.abs(neighborX - x) > 1 || idleData[neighbor * idleInfo.channels + 3] < ALPHA_THRESHOLD) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    if (area >= 500) components.push({left, top, width: right - left + 1, height: bottom - top + 1, area});
  }

  const minTop = Math.min(...components.map((component) => component.top));
  const maxTop = Math.max(...components.map((component) => component.top));
  const rowSplit = (minTop + maxTop) / 2;
  // 先按上下两行分组，再在每行按 X 排序；直接按 top 排序会被眨眼等细微边界变化打乱时间顺序。
  const topRow = components.filter((component) => component.top < rowSplit).sort((a, b) => a.left - b.left);
  const bottomRow = components.filter((component) => component.top >= rowSplit).sort((a, b) => a.left - b.left);
  const slots = [...topRow, ...bottomRow];
  // 图像模型偶尔将每行 15 格压缩为 14 格。每段至少 28 个姿态，随后均匀映射到 30 帧。
  if (slots.length < 28 || slots.length > 30) {
    throw new Error(`${label} must contain 28-30 separate poses; found ${slots.length}`);
  }
  return slots;
};

const idleSlots = idleSheets.map((sheet, index) => connectedIdleSlots(sheet, `idle segment ${index + 1}`));

const extractRaw = (data, info, left, top, width, height) => {
  const output = Buffer.alloc(width * height * info.channels);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = pixelOffset(info, left, top + y);
    data.copy(output, y * width * info.channels, sourceStart, sourceStart + width * info.channels);
  }
  return {data: output, info: {width, height, channels: info.channels}};
};

const visibleBounds = (data, info, label) => {
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[pixelOffset(info, x, y) + 3] < ALPHA_THRESHOLD) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error(`${label} has no visible pixels`);
  return {left, top, right, bottom, width: right - left + 1, height: bottom - top + 1};
};

const normalize = async (source, label) => {
  const bounds = visibleBounds(source.data, source.info, label);
  const crop = await sharp(source.data, {raw: source.info})
    .extract({left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height})
    .resize({height: TARGET_VISIBLE_HEIGHT, kernel: sharp.kernel.lanczos3})
    .png()
    .toBuffer();
  const metadata = await sharp(crop).metadata();
  if (!metadata.width || metadata.width > CELL) {
    throw new Error(`${label} would not fit in a ${CELL}px cell after scale normalization`);
  }
  // 统一高度并以固定脚部基线摆放，保证 idle/click/dock 切换没有缩放或纵向跳变。
  return sharp({
    create: {width: CELL, height: CELL, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
  })
    .composite([{input: crop, left: Math.round((CELL - metadata.width) / 2), top: BASELINE_Y - TARGET_VISIBLE_HEIGHT + 1}])
    .png()
    .toBuffer();
};

const sourceCell = (row, frame) => extractRaw(atlasData, atlasInfo, frame * CELL, row * CELL, CELL, CELL);
const sourceIdleFrame = (frame) => {
  // 尾帧直接复用首帧，循环边界可做到像素级闭合；其余帧均匀采样三段 28-30 帧源图。
  if (frame === IDLE_FRAMES - 1) {
    const firstSheet = idleSheets[0];
    const firstSlot = idleSlots[0][0];
    return extractRaw(firstSheet.data, firstSheet.info, firstSlot.left, firstSlot.top, firstSlot.width, firstSlot.height);
  }
  const segmentIndex = Math.floor(frame / 30);
  const segmentFrame = frame % 30;
  const sheet = idleSheets[segmentIndex];
  const slots = idleSlots[segmentIndex];
  const slot = slots[Math.round((segmentFrame * (slots.length - 1)) / 29)];
  return extractRaw(sheet.data, sheet.info, slot.left, slot.top, slot.width, slot.height);
};

await mkdir(normalizedRoot, {recursive: true});
await mkdir(qaRoot, {recursive: true});

const atlasComposites = [];
const report = {frameDurationMs: FRAME_DURATION_MS, targetVisibleHeight: TARGET_VISIBLE_HEIGHT, baselineY: BASELINE_Y, actions: {}};
const animations = Object.entries(manifest.animations).sort(([, left], [, right]) => left.row - right.row);

for (const [name, animation] of animations) {
  const frameCount = name === manifest.bindings.idle ? IDLE_FRAMES : animation.frames;
  const outputDir = path.join(normalizedRoot, name);
  await rm(outputDir, {recursive: true, force: true});
  await mkdir(outputDir, {recursive: true});
  const entries = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const isIdle = name === manifest.bindings.idle;
    const source = isIdle ? sourceIdleFrame(frame) : sourceCell(animation.row, frame);
    // 本次只重制 idle；其余动作逐像素保留，避免破坏已验收的吸边可见边缘。
    const output = isIdle
      ? await normalize(source, `${name}:${frame}`)
      : await sharp(source.data, {raw: source.info}).png().toBuffer();
    const outputPath = path.join(outputDir, `${String(frame).padStart(2, '0')}.png`);
    await writeFile(outputPath, output);
    // 长动作按行折返，避免 90 帧 idle 形成超过 GPU 常见纹理限制的超宽图集。
    atlasComposites.push({
      input: output,
      left: (frame % COLUMNS) * CELL,
      top: (animation.row + Math.floor(frame / COLUMNS)) * CELL,
    });
    const {data, info} = await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    entries.push(visibleBounds(data, info, `${name}:${frame}`));
  }

  // manifest 与 atlas 一起更新，避免图集帧数和运行时时序脱节。
  manifest.animations[name] = {
    ...animation,
    frames: frameCount,
    durationsMs: Array.from({length: frameCount}, () => FRAME_DURATION_MS),
    reducedMotionFrame: Math.min(animation.reducedMotionFrame, frameCount - 1),
  };
  report.actions[name] = entries;
}

const maxRow = Math.max(...Object.values(manifest.animations).map((animation) => animation.row + Math.ceil(animation.frames / COLUMNS) - 1));
await sharp({
  create: {
    width: COLUMNS * CELL,
    height: (maxRow + 1) * CELL,
    channels: 4,
    background: {r: 0, g: 0, b: 0, alpha: 0},
  },
})
  .composite(atlasComposites)
  .webp({lossless: true, effort: 6})
  .toFile(sourceAtlasPath);

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(path.join(qaRoot, 'normalization.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Rebuilt ${path.relative(root, sourceAtlasPath)} at ${FRAME_DURATION_MS.toFixed(6)}ms per frame`);
