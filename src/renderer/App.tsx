import {useEffect, useState} from 'react';
import {petManifestSchema, type PetManifest, type PetSettings} from '../shared/contracts';
import {defaultPetManifest} from '../shared/default-pet';
import {PetCanvas} from './PetCanvas';
import {SettingsView} from './SettingsView';

/** Renderer 根组件：同一入口按 query 参数渲染 Pet 窗口或设置窗口。 */
const view = new URLSearchParams(window.location.search).get('view') === 'settings' ? 'settings' : 'pet';

const loadManifest = async (): Promise<PetManifest> => {
  try {
    const url = new URL('pets/default/pet.json', document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load pet manifest: ${response.status}`);
    return petManifestSchema.parse(await response.json());
  } catch (error) {
    // 正式图集 manifest 损坏时使用编译期 fallback，避免透明窗口空白。
    console.error(error);
    return defaultPetManifest;
  }
};

export const App = () => {
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [manifest, setManifest] = useState<PetManifest>(defaultPetManifest);

  useEffect(() => {
    // 设置由主进程持久化，并通过广播同时同步给 Pet 与设置窗口。
    void window.desktopPet.getSettings().then(setSettings);
    void loadManifest().then(setManifest);
    return window.desktopPet.onSettingsChanged(setSettings);
  }, []);

  if (!settings) return null;
  return view === 'settings' ? (
    <SettingsView settings={settings} />
  ) : (
    <PetCanvas settings={settings} manifest={manifest} />
  );
};
