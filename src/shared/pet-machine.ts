import type {DockSide, PetManifest} from './contracts';

/**
 * Pet 交互状态机。副作用（窗口移动、声音、绘制）留在主进程或 Renderer，
 * reducer 只负责可测试的状态转换与动作语义选择。
 */
export type Direction = 'left' | 'right';
export type InteractionMode = 'idle' | 'dragging' | 'clickReaction' | 'docking' | 'docked';

export interface PetMachineState {
  mode: InteractionMode;
  dragDirection: Direction;
  dockSide: DockSide;
}

export type PetMachineEvent =
  | {type: 'DRAG_START'; direction: Direction}
  | {type: 'DRAG_DIRECTION'; direction: Direction}
  | {type: 'DRAG_END'; dockSide: DockSide}
  | {type: 'CLICK'}
  | {type: 'ANIMATION_DONE'}
  | {type: 'RESTORE_DOCK'; dockSide: DockSide};

export const initialPetState: PetMachineState = {
  mode: 'idle',
  dragDirection: 'right',
  dockSide: null,
};

export const petMachineReducer = (state: PetMachineState, event: PetMachineEvent): PetMachineState => {
  switch (event.type) {
    case 'DRAG_START':
      return {...state, mode: 'dragging', dragDirection: event.direction, dockSide: null};
    case 'DRAG_DIRECTION':
      return state.mode === 'dragging' ? {...state, dragDirection: event.direction} : state;
    case 'DRAG_END':
      return {
        ...state,
        mode: event.dockSide ? 'docking' : 'idle',
        dockSide: event.dockSide,
      };
    case 'CLICK':
      return {...state, mode: 'clickReaction'};
    case 'ANIMATION_DONE':
      // 点击发生在停靠状态时，反馈结束后必须回到边缘待机而不是普通 idle。
      if (state.mode === 'docking' || (state.mode === 'clickReaction' && state.dockSide)) {
        return {...state, mode: 'docked'};
      }
      if (state.mode === 'clickReaction') {
        return {...state, mode: 'idle'};
      }
      return state;
    case 'RESTORE_DOCK':
      return event.dockSide
        ? {...state, mode: 'docked', dockSide: event.dockSide}
        : {...state, mode: 'idle', dockSide: null};
  }
};

const safeBinding = (manifest: PetManifest, key: keyof PetManifest['bindings']) => {
  // 美术资源可替换；缺失 binding 时优雅回退到 idle，避免 Canvas 停止绘制。
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
    case 'idle':
      return safeBinding(manifest, 'idle');
  }
};

export const isDragDistance = (startX: number, startY: number, currentX: number, currentY: number, threshold: number) =>
  // 使用严格大于：恰好 6px 的手抖仍被视为点击。
  Math.hypot(currentX - startX, currentY - startY) > threshold;
