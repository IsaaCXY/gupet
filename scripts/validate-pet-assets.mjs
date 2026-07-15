import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const manifestPath = path.join(process.cwd(), 'public', 'pets', 'default', 'pet.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const atlasPath = path.join(process.cwd(), 'public', 'pets', 'default', path.basename(manifest.atlasPath));

if (manifest.schemaVersion !== 1) throw new Error('Unsupported pet schemaVersion');
if (manifest.cell?.width !== 256 || manifest.cell?.height !== 256 || manifest.cell?.columns !== 16) {
  throw new Error('Pet atlas must use 16 columns of 256x256 cells');
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

console.log(`Validated ${manifest.id}: ${metadata.width}x${metadata.height}, ${Object.keys(manifest.animations).length} animations`);
