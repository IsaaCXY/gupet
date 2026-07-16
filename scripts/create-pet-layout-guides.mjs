import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

/** 为生成阶段输出 4/6/8 帧条带的不可见布局参考图。 */
const outputDir = path.join(process.cwd(), 'work', 'pet-v1', 'references', 'layout-guides');
await mkdir(outputDir, {recursive: true});

for (const count of [4, 6, 8]) {
  // 所有 guide 都是 8 个固定槽位，未使用槽位以灰色标记，不能出现在最终素材中。
  const slots = Array.from({length: 8}, (_, index) => {
    const used = index < count;
    const x = index * 256;
    return `
      <rect x="${x + 8}" y="8" width="240" height="240" rx="16" fill="${used ? '#f0ecff' : '#d9d9df'}" stroke="${used ? '#7a5cff' : '#a5a5ad'}" stroke-width="4"/>
      ${used ? `<ellipse cx="${x + 128}" cy="128" rx="62" ry="94" fill="#7a5cff" opacity="0.28"/>` : ''}`;
  });
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="2048" height="256" viewBox="0 0 2048 256">
      <rect width="2048" height="256" fill="#ffffff"/>
      ${slots.join('\n')}
    </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(outputDir, `${count}-frames.png`));
}

console.log(`Created layout guides in ${outputDir}`);
