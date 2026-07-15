import {useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {getAnimationFrame} from '../shared/animation-clock';
import {DRAG_THRESHOLD, WINDOW_SIZE, type DragPoint, type PetManifest, type PetSettings} from '../shared/contracts';
import {
  classifyPointerZone,
  initialPetState,
  isDragDistance,
  normalizePointerX,
  petMachineReducer,
  resolveAnimationKey,
  type Direction,
  type PointerZone,
} from '../shared/pet-machine';

interface Props {
  settings: PetSettings;
  manifest: PetManifest;
}

interface ActivePointer {
  pointerId: number;
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

const POINTER_ZONE_DEBOUNCE_MS = 40;

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
  const alphaCacheRef = useRef(new Map<string, AlphaMask>());
  const frameRef = useRef(0);
  const [imageReady, setImageReady] = useState(false);
  const [state, dispatch] = useReducer(petMachineReducer, initialPetState);
  const stateRef = useRef(state);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const pendingMoveRef = useRef<DragPoint | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const ignoreMouseRef = useRef(true);
  const zoneRef = useRef<PointerZone>('center');
  const zoneCandidateRef = useRef<PointerZone>('center');
  const zoneTimerRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion(settings.motionMode);
  const animationKey = resolveAnimationKey(state, manifest);

  useEffect(() => {
    stateRef.current = state;
    zoneRef.current = state.pointerZone;
  }, [state]);

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
      const sourceX = result.frameIndex * manifest.cell.width;
      const sourceY = definition.row * manifest.cell.height;
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

      if (result.completed && !completionSent) {
        completionSent = true;
        dispatch({type: 'ANIMATION_DONE'});
      }
      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [animationKey, imageReady, manifest, reducedMotion, settings.petSize]);

  useEffect(
    () => () => {
      if (zoneTimerRef.current !== null) window.clearTimeout(zoneTimerRef.current);
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

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = manifest.cell.width;
    maskCanvas.height = manifest.cell.height;
    const context = maskCanvas.getContext('2d', {willReadFrequently: true});
    if (!context) return null;
    context.drawImage(
      image,
      frame * manifest.cell.width,
      definition.row * manifest.cell.height,
      manifest.cell.width,
      manifest.cell.height,
      0,
      0,
      manifest.cell.width,
      manifest.cell.height,
    );
    const pixels = context.getImageData(0, 0, manifest.cell.width, manifest.cell.height).data;
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
    const mask = getAlphaMask(animationKey, frameRef.current);
    if (!mask || mask.pixels[(sourceY * manifest.cell.width + sourceX) * 4 + 3] < manifest.hitTest.alphaThreshold) {
      return null;
    }
    return {normalizedX: normalizePointerX(sourceX, mask.visibleLeft, mask.visibleRight)};
  };

  const hitTest = (clientX: number, clientY: number) => getHit(clientX, clientY) !== null;

  const schedulePointerZone = (normalizedX: number) => {
    const next = classifyPointerZone(normalizedX, zoneRef.current);
    if (next === zoneRef.current) {
      if (zoneTimerRef.current !== null) window.clearTimeout(zoneTimerRef.current);
      zoneTimerRef.current = null;
      zoneCandidateRef.current = next;
      return;
    }
    if (next === zoneCandidateRef.current && zoneTimerRef.current !== null) return;
    if (zoneTimerRef.current !== null) window.clearTimeout(zoneTimerRef.current);
    zoneCandidateRef.current = next;
    zoneTimerRef.current = window.setTimeout(() => {
      zoneTimerRef.current = null;
      zoneRef.current = next;
      dispatch({type: 'POINTER_ZONE', zone: next});
    }, POINTER_ZONE_DEBOUNCE_MS);
  };

  const queueMove = (point: DragPoint) => {
    if (![point.screenX, point.screenY, point.grabX, point.grabY].every(Number.isFinite)) return;
    pendingMoveRef.current = point;
    if (moveFrameRef.current !== null) return;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      if (pendingMoveRef.current) window.desktopPet.movePet(pendingMoveRef.current);
      pendingMoveRef.current = null;
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || !hitTest(event.clientX, event.clientY)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setWindowInteractive(true);
    activePointerRef.current = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      grabX: event.clientX,
      grabY: event.clientY,
      lastScreenX: event.screenX,
      dragging: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = activePointerRef.current;
    if (!active) {
      const hit = getHit(event.clientX, event.clientY);
      setWindowInteractive(Boolean(hit));
      if (!hit) {
        dispatch({type: 'POINTER_LEAVE'});
        return;
      }
      schedulePointerZone(hit.normalizedX);
      return;
    }

    const deltaX = event.screenX - active.lastScreenX;
    const direction: Direction = deltaX < 0 ? 'left' : deltaX > 0 ? 'right' : stateRef.current.dragDirection;
    if (!active.dragging && isDragDistance(active.startScreenX, active.startScreenY, event.screenX, event.screenY, DRAG_THRESHOLD)) {
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

  const finishPointer = async (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = activePointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
      dispatch({type: 'CLICK'});
    }
    setWindowInteractive(hitTest(event.clientX, event.clientY));
  };

  const onPointerLeave = () => {
    if (activePointerRef.current) return;
    dispatch({type: 'POINTER_LEAVE'});
    setWindowInteractive(false);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`pet-canvas ${state.mode === 'dragging' ? 'dragging' : ''}`}
      aria-label={manifest.displayName}
      data-animation={animationKey}
      data-mode={state.mode}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => void finishPointer(event)}
      onPointerCancel={(event) => void finishPointer(event)}
      onPointerLeave={onPointerLeave}
      onContextMenu={(event) => {
        event.preventDefault();
        window.desktopPet.openContextMenu();
      }}
    />
  );
};
