import type {DesktopPetApi} from '../shared/contracts';

/** 为 Renderer 中由 Preload 注入的 window.desktopPet 提供类型。 */
declare global {
  interface Window {
    desktopPet: DesktopPetApi;
  }
}

export {};
