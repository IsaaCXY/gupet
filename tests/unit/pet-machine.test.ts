import {describe, expect, it} from 'vitest';
import {defaultPetManifest} from '../../src/shared/default-pet';
import {
  classifyPointerZone,
  initialPetState,
  isDragDistance,
  normalizePointerX,
  petMachineReducer,
  resolveAnimationKey,
} from '../../src/shared/pet-machine';

describe('pet machine', () => {
  it('keeps dragging above pointer feedback and resolves the directional animation', () => {
    let state = petMachineReducer(initialPetState, {type: 'DRAG_START', direction: 'left'});
    state = petMachineReducer(state, {type: 'POINTER_ZONE', zone: 'right'});

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

  it('uses the configured fallback when an animation binding is missing', () => {
    const manifest = structuredClone(defaultPetManifest);
    manifest.bindings.pointerLeft = 'not-present';
    const state = petMachineReducer(initialPetState, {type: 'POINTER_ZONE', zone: 'left'});
    expect(resolveAnimationKey(state, manifest)).toBe('idle');
  });
});

describe('pointer classification', () => {
  it('applies hysteresis before leaving the current zone', () => {
    expect(classifyPointerZone(0.48, 'left')).toBe('left');
    expect(classifyPointerZone(0.5, 'left')).toBe('center');
    expect(classifyPointerZone(0.43, 'center')).toBe('center');
    expect(classifyPointerZone(0.35, 'center')).toBe('left');
  });

  it('distinguishes click jitter from a drag', () => {
    expect(isDragDistance(0, 0, 6, 0, 6)).toBe(false);
    expect(isDragDistance(0, 0, 6.1, 0, 6)).toBe(true);
  });

  it('normalizes pointer position against the visible sprite instead of the full cell', () => {
    expect(normalizePointerX(110, 70, 190)).toBeCloseTo(0.333);
    expect(classifyPointerZone(normalizePointerX(110, 70, 190), 'center')).toBe('left');
    expect(classifyPointerZone(normalizePointerX(150, 70, 190), 'center')).toBe('right');
  });
});
