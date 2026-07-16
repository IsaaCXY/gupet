import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

/**
 * 生成开发占位图集，便于没有正式美术时调试交互。
 * 会覆盖 public/pets/default/atlas.webp，不能用于发布素材。
 */
const cell = 256;
// 正式图集为 32 列；3 秒 idle 使用前三行共 90 帧。
const columns = 32;
const rows = 10;
const frameCounts = [32, 32, 32, 12, 16, 16, 12, 12, 12, 12];

const frameArt = (row, frame) => {
  // 用 row 选择不同状态的简化姿势，便于肉眼识别状态机绑定是否正确。
  const phase = (frame / Math.max(1, frameCounts[row] - 1)) * Math.PI * 2;
  const bob = Math.round(Math.sin(phase) * (row === 0 ? 3 : 6));
  const drag = row === 4 ? -10 : row === 5 ? 10 : 0;
  const dockLean = row >= 6 ? (row <= 7 ? -8 : 8) : 0;
  const clickLift = row === 3 ? -Math.round(Math.sin((frame / 5) * Math.PI) * 28) : 0;
  const eyeShift = row === 1 ? -6 : row === 2 ? 6 : 0;
  const scale = row === 3 ? 1 + Math.sin((frame / 5) * Math.PI) * 0.08 : 1;
  const cx = 128 + drag + dockLean;
  const cy = 142 + bob + clickLift;
  const transform = `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`;
  const leftPaw = row === 4 || row === 6 || row === 7 ? 76 : 86;
  const rightPaw = row === 5 || row === 8 || row === 9 ? 180 : 170;

  return `
    <g transform="${transform}">
      <ellipse cx="${cx}" cy="206" rx="52" ry="12" fill="#5561c9" opacity="0.14"/>
      <path d="M78 105 L94 59 L119 91 Z" fill="#7180ff" stroke="#35418f" stroke-width="7" stroke-linejoin="round"/>
      <path d="M178 105 L162 59 L137 91 Z" fill="#7180ff" stroke="#35418f" stroke-width="7" stroke-linejoin="round"/>
      <ellipse cx="${cx}" cy="151" rx="67" ry="65" fill="#7180ff" stroke="#35418f" stroke-width="8"/>
      <ellipse cx="${cx}" cy="171" rx="43" ry="36" fill="#a9b0ff"/>
      <ellipse cx="${cx - 24}" cy="132" rx="10" ry="14" fill="#ffffff"/>
      <ellipse cx="${cx + 24}" cy="132" rx="10" ry="14" fill="#ffffff"/>
      <circle cx="${cx - 24 + eyeShift}" cy="135" r="5" fill="#202650"/>
      <circle cx="${cx + 24 + eyeShift}" cy="135" r="5" fill="#202650"/>
      <path d="M${cx - 8} 153 Q${cx} 160 ${cx + 8} 153" fill="none" stroke="#35418f" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="${leftPaw}" cy="184" rx="19" ry="14" fill="#7180ff" stroke="#35418f" stroke-width="6" transform="rotate(${row === 4 ? -22 : 0} ${leftPaw} 184)"/>
      <ellipse cx="${rightPaw}" cy="184" rx="19" ry="14" fill="#7180ff" stroke="#35418f" stroke-width="6" transform="rotate(${row === 5 ? 22 : 0} ${rightPaw} 184)"/>
    </g>`;
};

const groups = [];
for (let row = 0; row < rows; row += 1) {
  for (let frame = 0; frame < frameCounts[row]; frame += 1) {
    groups.push(`<g transform="translate(${frame * cell} ${row * cell})">${frameArt(row, frame)}</g>`);
  }
}

const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${columns * cell}" height="${rows * cell}" viewBox="0 0 ${columns * cell} ${rows * cell}">
    ${groups.join('\n')}
  </svg>`;

const output = path.join(process.cwd(), 'public', 'pets', 'default', 'atlas.webp');
await mkdir(path.dirname(output), {recursive: true});
await sharp(Buffer.from(svg)).webp({lossless: true, effort: 4}).toFile(output);
console.log(`Generated ${output}`);
