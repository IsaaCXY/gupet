import type {DockSide, PetManifest} from './contracts';

export type PointerZone = 'left' | 'center' | 'right';
export type Direction = 'left' | 'right';
export type InteractionMode = 'idle' | 'pointerLook' | 'dragging' | 'clickReaction' | 'docking' | 'docked';

export interface PetMachineState {
  mode: InteractionMode;
  pointerZone: PointerZone;
  dragDirection: Direction;
  dockSide: DockSide;
}

export type PetMachineEvent =
  | {type: 'POINTER_ZONE'; zone: PointerZone}
  | {type: 'POINTER_LEAVE'}
  | {type: 'DRAG_START'; direction: Direction}
  | {type: 'DRAG_DIRECTION'; direction: Direction}
  | {type: 'DRAG_END'; dockSide: DockSide}
  | {type: 'CLICK'}
  | {type: 'ANIMATION_DONE'}
  | {type: 'RESTORE_DOCK'; dockSide: DockSide};

export const initialPetState: PetMachineState = {
  mode: 'idle',
  pointerZone: 'center',
  dragDirection: 'right',
  dockSide: null,
};

export const petMachineReducer = (state: PetMachineState, event: PetMachineEvent): PetMachineState => {
  switch (event.type) {
    case 'POINTER_ZONE':
      if (state.mode === 'dragging' || state.mode === 'clickReaction' || state.mode === 'docking' || state.mode === 'docked') {
        return state;
      }
      return {
        ...state,
        pointerZone: event.zone,
        mode: event.zone === 'center' ? 'idle' : 'pointerLook',
      };
    case 'POINTER_LEAVE':
      if (state.mode === 'pointerLook') {
        return {...state, mode: 'idle', pointerZone: 'center'};
      }
      return state;
    case 'DRAG_START':
      return {...state, mode: 'dragging', dragDirection: event.direction, dockSide: null};
    case 'DRAG_DIRECTION':
      return state.mode === 'dragging' ? {...state, dragDirection: event.direction} : state;
    case 'DRAG_END':
      return {
        ...state,
        mode: event.dockSide ? 'docking' : 'idle',
        dockSide: event.dockSide,
        pointerZone: 'center',
      };
    case 'CLICK':
      return {...state, mode: 'clickReaction'};
    case 'ANIMATION_DONE':
      if (state.mode === 'docking' || (state.mode === 'clickReaction' && state.dockSide)) {
        return {...state, mode: 'docked'};
      }
      if (state.mode === 'clickReaction') {
        return {...state, mode: state.pointerZone === 'center' ? 'idle' : 'pointerLook'};
      }
      return state;
    case 'RESTORE_DOCK':
      return event.dockSide
        ? {...state, mode: 'docked', dockSide: event.dockSide}
        : {...state, mode: 'idle', dockSide: null};
  }
};

const safeBinding = (manifest: PetManifest, key: keyof PetManifest['bindings']) => {
  const candidate = manifest.bindings[key];
  return manifest.animations[candidate] ? candidate : manifest.bindings.idle;
};

export const resolveAnimationKey = (state: PetMachineState, manifest: PetManifest): string => {
  switch (state.mode) {
    case 'dragging':
      return safeBinding(manifest, state.dragDirection === 'left' ? 'dragLeft' : 'dragRight');
    case 'clickReaction':
      return safeBinding(manifest, 'click');
    case 'docking':
      return safeBinding(manifest, state.dockSide === 'left' ? 'dockLeftEnter' : 'dockRightEnter');
    case 'docked':
      return safeBinding(manifest, state.dockSide === 'left' ? 'dockLeftIdle' : 'dockRightIdle');
    case 'pointerLook':
      return safeBinding(manifest, state.pointerZone === 'left' ? 'pointerLeft' : 'pointerRight');
    case 'idle':
      return safeBinding(manifest, 'idle');
  }
};

export const classifyPointerZone = (
  normalizedX: number,
  current: PointerZone,
  hysteresis = 0.04,
): PointerZone => {
  const x = Math.min(1, Math.max(0, normalizedX));
  const leftBoundary = 0.45;
  const rightBoundary = 0.55;

  if (current === 'left' && x < leftBoundary + hysteresis) return 'left';
  if (current === 'right' && x > rightBoundary - hysteresis) return 'right';
  if (current === 'center') {
    if (x < leftBoundary - hysteresis) return 'left';
    if (x > rightBoundary + hysteresis) return 'right';
    return 'center';
  }

  if (x < leftBoundary) return 'left';
  if (x > rightBoundary) return 'right';
  return 'center';
};

export const normalizePointerX = (sourceX: number, visibleLeft: number, visibleRight: number): number => {
  const width = Math.max(1, visibleRight - visibleLeft);
  return Math.min(1, Math.max(0, (sourceX - visibleLeft) / width));
};

export const isDragDistance = (startX: number, startY: number, currentX: number, currentY: number, threshold: number) =>
  Math.hypot(currentX - startX, currentY - startY) > threshold;
