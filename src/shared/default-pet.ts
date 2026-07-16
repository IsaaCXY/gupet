import type {PetManifest} from './contracts';

/** 内置 fallback manifest：磁盘上的 pet.json 无法加载时仍可显示默认 Pet。 */
const repeated = (count: number, duration: number) => Array.from({length: count}, () => duration);
// 图集动作统一以 30fps 播放；帧超出 32 时按从左到右、从上到下跨行读取。
const FRAME_DURATION_30FPS = 1000 / 30;

export const defaultPetManifest: PetManifest = {
  schemaVersion: 1,
  id: 'penguin-suit-administrator-b',
  displayName: 'Penguin Suit Administrator (B.)',
  atlasPath: 'pets/default/atlas.webp',
  cell: {
    width: 256,
    height: 256,
    columns: 32,
  },
  animations: {
    // 单条连续动作链：抬鳍、轻拍一次、回落、眨眼并回到中性。
    idle: {row: 0, frames: 30, durationsMs: repeated(30, FRAME_DURATION_30FPS), loop: true, reducedMotionFrame: 0},
    'click-reaction': {row: 3, frames: 12, durationsMs: repeated(12, FRAME_DURATION_30FPS), loop: false, reducedMotionFrame: 6},
    'drag-left': {row: 4, frames: 16, durationsMs: repeated(16, FRAME_DURATION_30FPS), loop: true, reducedMotionFrame: 0},
    'drag-right': {row: 5, frames: 16, durationsMs: repeated(16, FRAME_DURATION_30FPS), loop: true, reducedMotionFrame: 0},
    'dock-left-enter': {row: 6, frames: 12, durationsMs: repeated(12, FRAME_DURATION_30FPS), loop: false, reducedMotionFrame: 10},
    'dock-left-idle': {row: 7, frames: 12, durationsMs: repeated(12, FRAME_DURATION_30FPS), loop: true, reducedMotionFrame: 0},
    'dock-right-enter': {row: 8, frames: 12, durationsMs: repeated(12, FRAME_DURATION_30FPS), loop: false, reducedMotionFrame: 10},
    'dock-right-idle': {row: 9, frames: 12, durationsMs: repeated(12, FRAME_DURATION_30FPS), loop: true, reducedMotionFrame: 0},
  },
  bindings: {
    idle: 'idle',
    click: 'click-reaction',
    dragLeft: 'drag-left',
    dragRight: 'drag-right',
    dockLeftEnter: 'dock-left-enter',
    dockLeftIdle: 'dock-left-idle',
    dockRightEnter: 'dock-right-enter',
    dockRightIdle: 'dock-right-idle',
  },
  hitTest: {
    alphaThreshold: 16,
  },
  sounds: {
    click: 'pets/default/click.wav',
  },
};
