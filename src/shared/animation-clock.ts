import type {AnimationDefinition} from './contracts';

/** 纯动画时钟：将经过时间映射为帧号，不依赖 Canvas 或 React。 */
export interface AnimationFrameResult {
  frameIndex: number;
  completed: boolean;
}

export const getAnimationFrame = (
  definition: AnimationDefinition,
  elapsedMs: number,
  reducedMotion: boolean,
): AnimationFrameResult => {
  if (reducedMotion) {
    // 减少动态效果仍让单次动作结束，避免状态机卡在 click/docking。
    const frameIndex = Math.min(definition.frames - 1, Math.max(0, definition.reducedMotionFrame));
    return {
      frameIndex,
      completed: !definition.loop && elapsedMs >= (definition.durationsMs[frameIndex] ?? 200),
    };
  }

  const durations = definition.durationsMs.slice(0, definition.frames);
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  if (total <= 0) return {frameIndex: 0, completed: !definition.loop};

  const completed = !definition.loop && elapsedMs >= total;
  // 循环动画取模；单次动画钳在最后一帧，保证不会越界。
  let cursor = definition.loop ? elapsedMs % total : Math.min(elapsedMs, total - 0.001);

  for (let index = 0; index < durations.length; index += 1) {
    if (cursor < durations[index]) return {frameIndex: index, completed};
    cursor -= durations[index];
  }

  return {frameIndex: Math.max(0, definition.frames - 1), completed};
};
