import type {DockSide, PetPlacement} from '../shared/contracts';

/**
 * 主进程使用的纯几何函数。
 * 坐标均为 Electron 的逻辑像素，因此可处理不同 DPI 与负坐标副屏。
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface SnapResult extends Point {
  dockSide: DockSide;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** 将窗口的垂直位置保存为工作区比例，供屏幕尺寸变化后恢复。 */
export const yRatioFor = (windowBounds: Rect, workArea: Rect): number => {
  const available = Math.max(1, workArea.height - windowBounds.height);
  return clamp((windowBounds.y - workArea.y) / available, 0, 1);
};

export const positionForPlacement = (
  placement: PetPlacement,
  workArea: Rect,
  windowSize: number,
  petSize: number,
): Point => {
  // Pet 在固定 320px 窗口内居中绘制，inset 是可见角色相对窗口的留白。
  const inset = (windowSize - petSize) / 2;
  const y = Math.round(workArea.y + placement.yRatio * Math.max(0, workArea.height - windowSize));

  if (placement.dockSide === 'left') {
    return {x: Math.round(workArea.x - inset), y};
  }
  if (placement.dockSide === 'right') {
    return {x: Math.round(workArea.x + workArea.width - inset - petSize), y};
  }

  return {
    x: clamp(placement.x ?? workArea.x + workArea.width - windowSize - 24, workArea.x, workArea.x + workArea.width - windowSize),
    y: clamp(placement.y ?? y, workArea.y, workArea.y + workArea.height - windowSize),
  };
};

export const xForDockedFrame = (
  dockSide: Exclude<DockSide, null>,
  workArea: Rect,
  windowSize: number,
  petSize: number,
  visibleLeft: number,
  visibleRight: number,
): number => {
  // 吸边以当前精灵帧的 alpha 可见边缘为准，不能以整张 256px 单元格为准。
  const inset = (windowSize - petSize) / 2;
  const scale = petSize / 256;
  const visibleEdge = dockSide === 'left' ? visibleLeft : visibleRight;
  const targetEdge = dockSide === 'left' ? workArea.x : workArea.x + workArea.width;
  return Math.round(targetEdge - inset - visibleEdge * scale);
};

export const snapOrClamp = (
  windowBounds: Rect,
  workArea: Rect,
  windowSize: number,
  petSize: number,
  threshold: number,
  enabled: boolean,
): SnapResult => {
  const inset = (windowSize - petSize) / 2;
  const visibleLeft = windowBounds.x + inset;
  const visibleRight = visibleLeft + petSize;
  const leftDistance = visibleLeft - workArea.x;
  const rightDistance = workArea.x + workArea.width - visibleRight;
  const y = clamp(windowBounds.y, workArea.y, workArea.y + workArea.height - windowSize);

  // 使用 <= 而不是绝对距离：角色被快速拖出边界后仍应能吸附。
  if (enabled && leftDistance <= threshold && leftDistance <= rightDistance) {
    return {x: Math.round(workArea.x - inset), y: Math.round(y), dockSide: 'left'};
  }
  if (enabled && rightDistance <= threshold) {
    return {
      x: Math.round(workArea.x + workArea.width - inset - petSize),
      y: Math.round(y),
      dockSide: 'right',
    };
  }

  return {
    x: Math.round(clamp(windowBounds.x, workArea.x, workArea.x + workArea.width - windowSize)),
    y: Math.round(y),
    dockSide: null,
  };
};
