import {useEffect, useMemo, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent} from 'react';
import {getAnimationFrame} from '../shared/animation-clock';
import {DRAG_THRESHOLD, WINDOW_SIZE, type DragPoint, type PetManifest, type PetSettings} from '../shared/contracts';
import {initialPetState, isDragDistance, petMachineReducer, resolveAnimationKey, type Direction} from '../shared/pet-machine';

/**
 * Pet 的实时渲染与交互层。
 * Canvas 负责逐帧绘制和 alpha 命中；状态机决定动作；窗口移动仍交给主进程。
 */
interface Props {
  settings: PetSettings;
  manifest: PetManifest;
}

interface ActivePointer {
  startScreenX: number;
  startScreenY: number;
  grabX: number;
  grabY: number;
  lastScreenX: number;
  dragging: boolean;
}

interface AlphaMask {
  pixels: Uint8ClampedArray;
  visibleLeft: number;
  visibleRight: number;
}

const useReducedMotion = (mode: PetSettings['motionMode']) => {
  const media = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), []);
  const [systemReduced, setSystemReduced] = useState(media.matches);

  useEffect(() => {
    const listener = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [media]);

  if (mode === 'reduced') return true;
  if (mode === 'full') return false;
  return systemReduced;
};

export const PetCanvas = ({settings, manifest}: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // alpha mask 同时服务于透明区域穿透与停靠时的可见边缘对齐。
  const alphaCacheRef = useRef(new Map<string, AlphaMask>());
  const frameRef = useRef(0);
  const clickAudioRef = useRef<HTMLAudioElement | null>(null);
  const dockAlignmentKeyRef = useRef<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [state, dispatch] = useReducer(petMachineReducer, initialPetState);
  const stateRef = useRef(state);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const pendingMoveRef = useRef<DragPoint | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const ignoreMouseRef = useRef(true);
  const reducedMotion = useReducedMotion(settings.motionMode);
  const animationKey = resolveAnimationKey(state, manifest);

  /** 长动作在固定 32 列图集内折行，避免把 3 秒 idle 做成过宽纹理。 */
  const getFrameCell = (definition: PetManifest['animations'][string], frame: number) => ({
    column: frame % manifest.cell.columns,
    row: definition.row + Math.floor(frame / manifest.cell.columns),
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(
    () => window.desktopPet.onPetVisibilityChanged(() => {
      // 隐藏时丢弃未完成拖动，避免再次显示后带着陈旧鼠标状态移动窗口。
      activePointerRef.current = null;
      ignoreMouseRef.current = true;
    }),
    [],
  );

  useEffect(() => {
    void window.desktopPet.getPlacement().then((placement) => {
      dispatch({type: 'RESTORE_DOCK', dockSide: placement.dockSide});
    });
  }, []);

  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      imageRef.current = image;
      alphaCacheRef.current.clear();
      setImageReady(true);
    };
    image.onerror = () => console.error(`Unable to load pet atlas: ${image.src}`);
    image.src = new URL(manifest.atlasPath, document.baseURI).toString();
    return () => {
      imageRef.current = null;
      setImageReady(false);
    };
  }, [manifest.atlasPath]);

  useEffect(() => {
    const soundPath = manifest.sounds?.click;
    if (!soundPath) {
      clickAudioRef.current = null;
      return;
    }
    const audio = new Audio(new URL(soundPath, document.baseURI).toString());
    audio.preload = 'auto';
    clickAudioRef.current = audio;
    return () => {
      if (clickAudioRef.current === audio) clickAudioRef.current = null;
      audio.pause();
      audio.src = '';
    };
  }, [manifest.sounds?.click]);

  useEffect(() => {
    if (!imageReady) return;
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const definition = manifest.animations[animationKey] ?? manifest.animations[manifest.bindings.idle];
    if (!canvas || !image || !definition) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(WINDOW_SIZE * ratio);
    canvas.height = Math.round(WINDOW_SIZE * ratio);
    canvas.style.width = `${WINDOW_SIZE}px`;
    canvas.style.height = `${WINDOW_SIZE}px`;
    const context = canvas.getContext('2d', {alpha: true});
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    let animationFrame = 0;
    let completionSent = false;
    const startedAt = performance.now();

    const draw = (now: number) => {
      const result = getAnimationFrame(definition, now - startedAt, reducedMotion);
      frameRef.current = result.frameIndex;
      const frameCell = getFrameCell(definition, result.frameIndex);
      const sourceX = frameCell.column * manifest.cell.width;
      const sourceY = frameCell.row * manifest.cell.height;
      const destination = (WINDOW_SIZE - settings.petSize) / 2;
      context.clearRect(0, 0, WINDOW_SIZE, WINDOW_SIZE);
      context.drawImage(
        image,
        sourceX,
        sourceY,
        manifest.cell.width,
        manifest.cell.height,
        destination,
        destination,
        settings.petSize,
        settings.petSize,
      );

      if ((state.mode === 'docking' || state.mode === 'docked') && state.dockSide) {
        const idleKey = state.dockSide === 'left' ? manifest.bindings.dockLeftIdle : manifest.bindings.dockRightIdle;
        const dockAlignmentKey = `${state.dockSide}:${idleKey}:${settings.petSize}`;
        if (dockAlignmentKeyRef.current !== dockAlignmentKey) {
          dockAlignmentKeyRef.current = dockAlignmentKey;
          const mask = getAlphaMask(idleKey, 0);
          if (mask) {
            // 只在停靠侧、动作或缩放变化时通知主进程，避免每帧跨进程通信。
            window.desktopPet.alignDockedFrame({
              visibleLeft: mask.visibleLeft,
              visibleRight: mask.visibleRight,
            });
          }
        }
      } else {
        dockAlignmentKeyRef.current = null;
      }

      if (result.completed && !completionSent) {
        completionSent = true;
        dispatch({type: 'ANIMATION_DONE'});
      }
      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [animationKey, imageReady, manifest, reducedMotion, settings.petSize, state.dockSide, state.mode]);

  useEffect(
    () => () => {
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
      window.desktopPet.setIgnoreMouseEvents(true);
    },
    [],
  );

  const setWindowInteractive = (interactive: boolean) => {
    const shouldIgnore = !interactive;
    if (ignoreMouseRef.current === shouldIgnore) return;
    ignoreMouseRef.current = shouldIgnore;
    window.desktopPet.setIgnoreMouseEvents(shouldIgnore);
  };

  const getAlphaMask = (animation: string, frame: number) => {
    const key = `${animation}:${frame}`;
    const cached = alphaCacheRef.current.get(key);
    if (cached) return cached;
    const image = imageRef.current;
    const definition = manifest.animations[animation];
    if (!image || !definition) return null;

    // 从原图集裁出单帧再读 alpha；结果缓存后命中测试不会重复读取像素。
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = manifest.cell.width;
    maskCanvas.height = manifest.cell.height;
    const context = maskCanvas.getContext('2d', {willReadFrequently: true});
    if (!context) return null;
    const frameCell = getFrameCell(definition, frame);
    context.drawImage(
      image,
      frameCell.column * manifest.cell.width,
      frameCell.row * manifest.cell.height,
      manifest.cell.width,
      manifest.cell.height,
      0,
      0,
      manifest.cell.width,
      manifest.cell.height,
    );
    const pixels = context.getImageData(0, 0, manifest.cell.width, manifest.cell.height).data;
    // 同时记录可见左右边缘，供停靠时把实际角色边缘贴到屏幕边缘。
    let visibleLeft: number = manifest.cell.width;
    let visibleRight: number = -1;
    for (let y = 0; y < manifest.cell.height; y += 1) {
      for (let x = 0; x < manifest.cell.width; x += 1) {
        if (pixels[(y * manifest.cell.width + x) * 4 + 3] < manifest.hitTest.alphaThreshold) continue;
        visibleLeft = Math.min(visibleLeft, x);
        visibleRight = Math.max(visibleRight, x);
      }
    }
    const mask = {
      pixels,
      visibleLeft: visibleRight >= visibleLeft ? visibleLeft : 0,
      visibleRight: visibleRight >= visibleLeft ? visibleRight : manifest.cell.width - 1,
    };
    alphaCacheRef.current.set(key, mask);
    return mask;
  };

  const getHit = (clientX: number, clientY: number) => {
    const destination = (WINDOW_SIZE - settings.petSize) / 2;
    if (
      clientX < destination ||
      clientY < destination ||
      clientX >= destination + settings.petSize ||
      clientY >= destination + settings.petSize
    ) {
      return null;
    }

    const sourceX = Math.min(
      manifest.cell.width - 1,
      Math.floor(((clientX - destination) / settings.petSize) * manifest.cell.width),
    );
    const sourceY = Math.min(
      manifest.cell.height - 1,
      Math.floor(((clientY - destination) / settings.petSize) * manifest.cell.height),
    );
    // 透明像素不应拦截桌面点击；每次按当前动画帧判断。
    const mask = getAlphaMask(animationKey, frameRef.current);
    if (!mask || mask.pixels[(sourceY * manifest.cell.width + sourceX) * 4 + 3] < manifest.hitTest.alphaThreshold) {
      return null;
    }
    return true;
  };

  const hitTest = (clientX: number, clientY: number) => getHit(clientX, clientY) !== null;

  const queueMove = (point: DragPoint) => {
    if (![point.screenX, point.screenY, point.grabX, point.grabY].every(Number.isFinite)) return;
    pendingMoveRef.current = point;
    if (moveFrameRef.current !== null) return;
    // 浏览器鼠标事件可能高于显示刷新率；每个渲染帧最多请求一次原生窗口移动。
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      if (pendingMoveRef.current) window.desktopPet.movePet(pendingMoveRef.current);
      pendingMoveRef.current = null;
    });
  };

  // 穿透窗口仅会转发原生 mousemove；Windows 上它不稳定地转换为 PointerEvent，
  // 因此整个交互链统一使用 MouseEvent，避免混用两套事件模型。
  const onMouseDown = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || !hitTest(event.clientX, event.clientY)) return;
    setWindowInteractive(true);
    activePointerRef.current = {
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      grabX: event.clientX,
      grabY: event.clientY,
      lastScreenX: event.screenX,
      dragging: false,
    };
  };

  const onMouseMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const active = activePointerRef.current;
    if (!active) {
      const hit = getHit(event.clientX, event.clientY);
      setWindowInteractive(Boolean(hit));
      return;
    }

    const deltaX = event.screenX - active.lastScreenX;
    const direction: Direction = deltaX < 0 ? 'left' : deltaX > 0 ? 'right' : stateRef.current.dragDirection;
    if (!active.dragging && isDragDistance(active.startScreenX, active.startScreenY, event.screenX, event.screenY, DRAG_THRESHOLD)) {
      // 超过阈值才开始拖动，轻微手抖仍保留为点击反馈。
      active.dragging = true;
      dispatch({type: 'DRAG_START', direction});
    } else if (active.dragging && direction !== stateRef.current.dragDirection) {
      dispatch({type: 'DRAG_DIRECTION', direction});
    }
    active.lastScreenX = event.screenX;

    if (active.dragging) {
      queueMove({
        screenX: event.screenX,
        screenY: event.screenY,
        grabX: active.grabX,
        grabY: active.grabY,
      });
    }
  };

  const finishMouse = async (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const active = activePointerRef.current;
    if (!active) return;
    activePointerRef.current = null;

    if (active.dragging) {
      if (moveFrameRef.current !== null) {
        cancelAnimationFrame(moveFrameRef.current);
        moveFrameRef.current = null;
      }
      if (pendingMoveRef.current) window.desktopPet.movePet(pendingMoveRef.current);
      pendingMoveRef.current = null;
      const dockSide = await window.desktopPet.finishDrag();
      dispatch({type: 'DRAG_END', dockSide});
    } else {
      // 声音是可选资源，播放失败不能影响点击状态转换。
      const audio = clickAudioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch((error: unknown) => console.warn('Unable to play click sound', error));
      }
      dispatch({type: 'CLICK'});
    }
    setWindowInteractive(hitTest(event.clientX, event.clientY));
  };

  const onMouseLeave = () => {
    if (activePointerRef.current) return;
    setWindowInteractive(false);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`pet-canvas ${state.mode === 'dragging' ? 'dragging' : ''}`}
      aria-label={manifest.displayName}
      data-animation={animationKey}
      data-mode={state.mode}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={(event) => void finishMouse(event)}
      onMouseLeave={onMouseLeave}
      onContextMenu={(event) => {
        event.preventDefault();
        window.desktopPet.openContextMenu();
      }}
    />
  );
};
