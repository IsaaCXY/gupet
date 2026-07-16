import {contextBridge, ipcRenderer} from 'electron';
import type {DesktopPetApi, DockFrameBounds, DragPoint, PetSettings} from '../shared/contracts';

/**
 * 安全 IPC 桥：Renderer 只能调用这组白名单 API，无法直接 require Electron/Node。
 */
const api: DesktopPetApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<PetSettings>) => ipcRenderer.invoke('settings:update', patch),
  onSettingsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: PetSettings) => listener(settings);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
  onPetVisibilityChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => listener(visible);
    ipcRenderer.on('pet:visibility-changed', handler);
    return () => ipcRenderer.removeListener('pet:visibility-changed', handler);
  },
  getPlacement: () => ipcRenderer.invoke('pet:get-placement'),
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('pet:set-ignore-mouse-events', ignore),
  movePet: (point: DragPoint) => ipcRenderer.send('pet:move', point),
  finishDrag: () => ipcRenderer.invoke('pet:finish-drag'),
  alignDockedFrame: (bounds: DockFrameBounds) => ipcRenderer.send('pet:align-docked-frame', bounds),
  resetPosition: () => ipcRenderer.invoke('pet:reset-position'),
  openContextMenu: () => ipcRenderer.send('pet:context-menu'),
};

// 挂到 window 的唯一桌面能力入口，类型声明位于 renderer/global.d.ts。
contextBridge.exposeInMainWorld('desktopPet', api);
