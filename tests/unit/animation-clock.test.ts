import {describe, expect, it} from 'vitest';
import {getAnimationFrame} from '../../src/shared/animation-clock';
import type {AnimationDefinition} from '../../src/shared/contracts';

const loop: AnimationDefinition = {
  row: 0,
  frames: 3,
  durationsMs: [100, 200, 300],
  loop: true,
  reducedMotionFrame: 1,
};

describe('animation clock', () => {
  it('selects frames with variable durations and loops', () => {
    expect(getAnimationFrame(loop, 99, false).frameIndex).toBe(0);
    expect(getAnimationFrame(loop, 100, false).frameIndex).toBe(1);
    expect(getAnimationFrame(loop, 599, false).frameIndex).toBe(2);
    expect(getAnimationFrame(loop, 600, false).frameIndex).toBe(0);
  });

  it('holds the last frame and reports a completed one-shot', () => {
    const oneShot = {...loop, loop: false};
    expect(getAnimationFrame(oneShot, 600, false)).toEqual({frameIndex: 2, completed: true});
  });

  it('uses a still frame but lets one-shot states finish in reduced motion', () => {
    const oneShot = {...loop, loop: false};
    expect(getAnimationFrame(oneShot, 100, true)).toEqual({frameIndex: 1, completed: false});
    expect(getAnimationFrame(oneShot, 200, true)).toEqual({frameIndex: 1, completed: true});
  });
});
