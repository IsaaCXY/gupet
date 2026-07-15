import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const root = process.cwd();
const petRoot = path.join(root, 'public', 'pets', 'default');
const sourceAtlasPath = path.join(petRoot, 'atlas.webp');
const manifestPath = path.join(petRoot, 'pet.json');
const idleStripPath = path.join(root, 'assets', 'pets', 'default', 'idle-strip-alpha.png');
const normalizedRoot = path.join(root, 'work', 'pet-v2', 'normalized');
const qaRoot = path.join(root, 'work', 'pet-v2', 'qa');

const CELL = 256;
const COLUMNS = 16;
const IDLE_FRAMES = 16;
const FRAME_DURATION_MS = 1000 / 30;
const ALPHA_THRESHOLD = 16;
const TARGET_VISIBLE_HEIGHT = 224;
const BASELINE_Y = 239;

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const {data: atlasData, info: atlasInfo} = await sharp(sourceAtlasPath).ensureAlpha().raw().toBuffer({resolveWithObject: true});
const {data: idleData, info: idleInfo} = await sharp(idleStripPath).ensureAlpha().raw().toBuffer({resolveWithObject: true});

if (idleInfo.width < IDLE_FRAMES || idleInfo.height < 1) {
  throw new Error(`Idle strip is too small: ${idleInfo.width}x${idleInfo.height}`);
}

const pixelOffset = (info, x, y) => (y * info.width + x) * info.channels;

const connectedIdleSlots = () => {
  const occupied = Array.from({length: idleInfo.width}, (_, x) => {
    for (let y = 0; y < idleInfo.height; y += 1) {
      if (idleData[pixelOffset(idleInfo, x, y) + 3] >= ALPHA_THRESHOLD) return true;
    }
    return false;
  });
  const slots = [];
  let start = null;
  for (let x = 0; x <= occupied.length; x += 1) {
    if (occupied[x] && start === null) start = x;
    if ((!occupied[x] || x === occupied.length) && start !== null) {
      slots.push({left: start, width: x - start});
      start = null;
    }
  }
  if (slots.length < 2) throw new Error(`Idle strip must contain separate poses; found ${slots.length}`);
  return slots;
};

const idleSlots = connectedIdleSlots();

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
  return sharp({
    create: {width: CELL, height: CELL, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}},
  })
    .composite([{input: crop, left: Math.round((CELL - metadata.width) / 2), top: BASELINE_Y - TARGET_VISIBLE_HEIGHT + 1}])
    .png()
    .toBuffer();
};

const sourceCell = (row, frame) => extractRaw(atlasData, atlasInfo, frame * CELL, row * CELL, CELL, CELL);
const sourceIdleFrame = (frame) => {
  const sourceIndex = frame >= idleSlots.length ? 0 : frame;
  const slot = idleSlots[sourceIndex];
  return extractRaw(idleData, idleInfo, slot.left, 0, slot.width, idleInfo.height);
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
    // The source strip may contain fewer than 16 independent poses. Reuse neutral frame 0
    // for tail slots and force the final frame to equal frame 0 for a seamless loop boundary.
    const source = name === manifest.bindings.idle ? sourceIdleFrame(frame === frameCount - 1 ? 0 : frame) : sourceCell(animation.row, frame);
    const output = await normalize(source, `${name}:${frame}`);
    const outputPath = path.join(outputDir, `${String(frame).padStart(2, '0')}.png`);
    await writeFile(outputPath, output);
    atlasComposites.push({input: output, left: frame * CELL, top: animation.row * CELL});
    const {data, info} = await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    entries.push(visibleBounds(data, info, `${name}:${frame}`));
  }

  manifest.animations[name] = {
    ...animation,
    frames: frameCount,
    durationsMs: Array.from({length: frameCount}, () => FRAME_DURATION_MS),
    reducedMotionFrame: Math.min(animation.reducedMotionFrame, frameCount - 1),
  };
  report.actions[name] = entries;
}

const maxRow = Math.max(...Object.values(manifest.animations).map((animation) => animation.row));
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
