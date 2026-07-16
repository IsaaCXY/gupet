import path from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
  type Display,
} from 'electron';
import {WINDOW_SIZE, dockFrameBoundsSchema, dragPointSchema, type DockFrameBounds, type DockSide, type PetPlacement, type PetSettings} from '../shared/contracts';
import {positionForPlacement, snapOrClamp, xForDockedFrame, yRatioFor} from './geometry';
import {StateStore} from './state-store';

/**
 * Electron 主进程：拥有原生窗口、托盘、屏幕坐标和持久化状态。
 * Renderer 只通过 Preload 暴露的窄 IPC 请求这些桌面能力。
 */
let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: StateStore;
let quitting = false;
// 记录停靠待机帧的 alpha 边缘，使不同帧不会把可见角色从屏幕边缘弹开。
let dockAnchorBounds: DockFrameBounds | null = null;
let petHidden = false;

const loadRenderer = async (window: BrowserWindow, view: 'pet' | 'settings') => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    url.searchParams.set('view', view);
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
    query: {view},
  });
};

const displayForPlacement = (placement: PetPlacement): Display => {
  // 已保存的显示器可能在下次启动前被移除，回退到主显示器。
  const displays = screen.getAllDisplays();
  return displays.find((display) => display.id === placement.displayId) ?? screen.getPrimaryDisplay();
};

const applySavedPlacement = () => {
  if (!petWindow) return;
  const placement = store.getPlacement();
  const display = displayForPlacement(placement);
  const settings = store.getSettings();
  const position = positionForPlacement(placement, display.workArea, WINDOW_SIZE, settings.petSize);
  if (placement.dockSide && dockAnchorBounds) {
    // 普通位置按窗口边界恢复；停靠位置则按精灵的可见边界恢复。
    position.x = xForDockedFrame(
      placement.dockSide,
      display.workArea,
      WINDOW_SIZE,
      settings.petSize,
      dockAnchorBounds.visibleLeft,
      dockAnchorBounds.visibleRight,
    );
  }
  petWindow.setPosition(Math.round(position.x), Math.round(position.y), false);
};

const persistCurrentPlacement = (dockSide: DockSide) => {
  if (!petWindow) return store.getPlacement();
  const bounds = petWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + Math.floor(bounds.height / 2),
  });
  return store.updatePlacement({
    displayId: display.id,
    x: bounds.x,
    y: bounds.y,
    yRatio: yRatioFor(bounds, display.workArea),
    dockSide,
  });
};

const broadcastSettings = (settings: PetSettings) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('settings:changed', settings);
  }
};

const applySettings = (settings: PetSettings) => {
  petWindow?.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  if (app.isPackaged) app.setLoginItemSettings({openAtLogin: settings.launchAtLogin});
  if (store.getPlacement().dockSide) applySavedPlacement();
  broadcastSettings(settings);
};

const finishDrag = (): DockSide => {
  if (!petWindow) return null;
  const bounds = petWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + Math.floor(bounds.height / 2),
  });
  const settings = store.getSettings();
  const result = snapOrClamp(
    bounds,
    display.workArea,
    WINDOW_SIZE,
    settings.petSize,
    settings.snapThreshold,
    settings.snapEdges,
  );
  petWindow.setPosition(result.x, result.y, false);
  persistCurrentPlacement(result.dockSide);
  return result.dockSide;
};

const resetPosition = (): PetPlacement => {
  if (!petWindow) return store.getPlacement();
  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.workArea.x + display.workArea.width - WINDOW_SIZE - 24);
  const y = Math.round(display.workArea.y + (display.workArea.height - WINDOW_SIZE) * 0.72);
  petWindow.setPosition(x, y, false);
  return persistCurrentPlacement(null);
};

const movePet = (input: unknown) => {
  if (!petWindow) return;
  // IPC 数据在运行时不可信，必须在进入 Electron 原生 API 前校验。
  const parsed = dragPointSchema.safeParse(input);
  if (!parsed.success) return;
  const point = parsed.data;
  const x = Math.round(point.screenX - point.grabX);
  const y = Math.round(point.screenY - point.grabY);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return;
  petWindow.setPosition(x, y, false);
};

const alignDockedFrame = (input: unknown) => {
  if (!petWindow) return;
  const bounds = dockFrameBoundsSchema.safeParse(input);
  const placement = store.getPlacement();
  if (!bounds.success || !placement.dockSide) return;
  dockAnchorBounds = bounds.data;
  const display = displayForPlacement(placement);
  const settings = store.getSettings();
  const {y} = petWindow.getBounds();
  const x = xForDockedFrame(
    placement.dockSide,
    display.workArea,
    WINDOW_SIZE,
    settings.petSize,
    bounds.data.visibleLeft,
    bounds.data.visibleRight,
  );
  petWindow.setPosition(x, y, false);
};

const createPetWindow = async () => {
  const settings = store.getSettings();
  petHidden = false;
  // 固定尺寸透明窗口承载 Canvas；Pet 的实际显示尺寸由 Renderer 绘制控制。
  petWindow = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: settings.alwaysOnTop,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === 'darwin') {
    petWindow.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
  }

  // 初始穿透透明窗口；Renderer 命中到 alpha 像素后会临时关闭穿透。
  petWindow.setIgnoreMouseEvents(true, {forward: true});
  petWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      setPetVisible(false);
    }
  });
  petWindow.on('closed', () => {
    petWindow = null;
  });
  petWindow.on('show', refreshTrayMenu);
  petWindow.on('hide', refreshTrayMenu);

  await loadRenderer(petWindow, 'pet');
  applySavedPlacement();
  petWindow.showInactive();
};

const createSettingsWindow = async () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 460,
    height: 600,
    minWidth: 420,
    minHeight: 540,
    title: 'Desktop Pet Settings',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  await loadRenderer(settingsWindow, 'settings');
  settingsWindow.show();
};

const createTrayImage = () => {
  const width = 18;
  const height = 18;
  const bitmap = Buffer.alloc(width * height * 4);
  const circles = [
    {x: 9, y: 11, r: 5},
    {x: 4, y: 6, r: 2},
    {x: 8, y: 4, r: 2},
    {x: 13, y: 6, r: 2},
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const opaque = circles.some((circle) => (x - circle.x) ** 2 + (y - circle.y) ** 2 <= circle.r ** 2);
      const offset = (y * width + x) * 4;
      bitmap[offset] = 0;
      bitmap[offset + 1] = 0;
      bitmap[offset + 2] = 0;
      bitmap[offset + 3] = opaque ? 255 : 0;
    }
  }
  const image = nativeImage.createFromBitmap(bitmap, {width, height, scaleFactor: 1});
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
};

const trayMenu = () =>
  Menu.buildFromTemplate([
    {
      label: !petHidden && petWindow?.isVisible() ? 'Hide Pet' : 'Show Pet',
      click: togglePetVisibility,
    },
    {label: 'Settings…', click: () => void createSettingsWindow()},
    {label: 'Reset Position', click: resetPosition},
    {type: 'separator'},
    {
      label: 'Quit',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);

const refreshTrayMenu = () => tray?.setContextMenu(trayMenu());

const setPetVisible = (visible: boolean) => {
  if (!petWindow) return;
  petHidden = !visible;
  // 隐藏采用透明度而非 close，保留窗口位置和 Renderer 运行状态。
  petWindow.setIgnoreMouseEvents(!visible, !visible ? {forward: true} : undefined);
  if (visible && !petWindow.isVisible()) petWindow.showInactive();
  petWindow.setOpacity(visible ? 1 : 0);
  petWindow.webContents.send('pet:visibility-changed', visible);
  refreshTrayMenu();
};

const togglePetVisibility = () => {
  setPetVisible(petHidden);
};

const createTray = () => {
  tray = new Tray(createTrayImage());
  tray.setToolTip('Desktop Pet');
  tray.on('click', togglePetVisibility);
  tray.on('right-click', () => {
    refreshTrayMenu();
    tray?.popUpContextMenu(trayMenu());
  });
  refreshTrayMenu();
};

const registerIpc = () => {
  // 只注册 Preload API 所需的通道，避免把任意 Electron 能力暴露给网页。
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', (_event, patch: Partial<PetSettings>) => {
    const settings = store.updateSettings(patch);
    applySettings(settings);
    return settings;
  });
  ipcMain.handle('pet:get-placement', () => store.getPlacement());
  ipcMain.handle('pet:finish-drag', () => finishDrag());
  ipcMain.handle('pet:reset-position', () => resetPosition());
  ipcMain.on('pet:set-ignore-mouse-events', (_event, ignore: boolean) => {
    petWindow?.setIgnoreMouseEvents(Boolean(ignore), ignore ? {forward: true} : undefined);
  });
  ipcMain.on('pet:move', (_event, point: unknown) => movePet(point));
  ipcMain.on('pet:align-docked-frame', (_event, bounds: unknown) => alignDockedFrame(bounds));
  ipcMain.on('pet:context-menu', () => tray?.popUpContextMenu(trayMenu()));
};

app.whenReady().then(async () => {
  store = new StateStore();
  registerIpc();
  await createPetWindow();
  createTray();
  applySettings(store.getSettings());

  screen.on('display-removed', applySavedPlacement);
  screen.on('display-metrics-changed', applySavedPlacement);
  app.on('activate', () => {
    if (!petWindow) void createPetWindow();
    else setPetVisible(true);
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // The tray owns the application lifetime on both supported platforms.
});
