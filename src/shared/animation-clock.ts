import type {AnimationDefinition} from './contracts';

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
  let cursor = definition.loop ? elapsedMs % total : Math.min(elapsedMs, total - 0.001);

  for (let index = 0; index < durations.length; index += 1) {
    if (cursor < durations[index]) return {frameIndex: index, completed};
    cursor -= durations[index];
  }

  return {frameIndex: Math.max(0, definition.frames - 1), completed};
};
