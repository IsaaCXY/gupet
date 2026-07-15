import {describe, expect, it} from 'vitest';
import {defaultPetManifest} from '../../src/shared/default-pet';
import {
  initialPetState,
  isDragDistance,
  petMachineReducer,
  resolveAnimationKey,
} from '../../src/shared/pet-machine';

describe('pet machine', () => {
  it('keeps the drag animation active until the drag ends', () => {
    let state = petMachineReducer(initialPetState, {type: 'DRAG_START', direction: 'left'});
    state = petMachineReducer(state, {type: 'DRAG_DIRECTION', direction: 'left'});

    expect(state.mode).toBe('dragging');
    expect(resolveAnimationKey(state, defaultPetManifest)).toBe('drag-left');
  });

  it('enters a dock transition and then the dock loop', () => {
    let state = petMachineReducer(initialPetState, {type: 'DRAG_START', direction: 'right'});
    state = petMachineReducer(state, {type: 'DRAG_END', dockSide: 'right'});
    expect(resolveAnimationKey(state, defaultPetManifest)).toBe('dock-right-enter');

    state = petMachineReducer(state, {type: 'ANIMATION_DONE'});
    expect(state.mode).toBe('docked');
    expect(resolveAnimationKey(state, defaultPetManifest)).toBe('dock-right-idle');
  });

  it('returns a docked pet to the dock loop after a click reaction', () => {
    let state = petMachineReducer(initialPetState, {type: 'RESTORE_DOCK', dockSide: 'left'});
    state = petMachineReducer(state, {type: 'CLICK'});
    expect(resolveAnimationKey(state, defaultPetManifest)).toBe('click-reaction');

    state = petMachineReducer(state, {type: 'ANIMATION_DONE'});
    expect(state.mode).toBe('docked');
    expect(state.dockSide).toBe('left');
  });

  it('uses the configured fallback when the click binding is missing', () => {
    const manifest = structuredClone(defaultPetManifest);
    manifest.bindings.click = 'not-present';
    const state = petMachineReducer(initialPetState, {type: 'CLICK'});
    expect(resolveAnimationKey(state, manifest)).toBe('idle');
  });
});

describe('pointer gestures', () => {
  it('distinguishes click jitter from a drag', () => {
    expect(isDragDistance(0, 0, 6, 0, 6)).toBe(false);
    expect(isDragDistance(0, 0, 6.1, 0, 6)).toBe(true);
  });
});
