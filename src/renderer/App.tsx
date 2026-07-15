import {useEffect, useState} from 'react';
import {petManifestSchema, type PetManifest, type PetSettings} from '../shared/contracts';
import {defaultPetManifest} from '../shared/default-pet';
import {PetCanvas} from './PetCanvas';
import {SettingsView} from './SettingsView';

const view = new URLSearchParams(window.location.search).get('view') === 'settings' ? 'settings' : 'pet';

const loadManifest = async (): Promise<PetManifest> => {
  try {
    const url = new URL('pets/default/pet.json', document.baseURI);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load pet manifest: ${response.status}`);
    return petManifestSchema.parse(await response.json());
  } catch (error) {
    console.error(error);
    return defaultPetManifest;
  }
};

export const App = () => {
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [manifest, setManifest] = useState<PetManifest>(defaultPetManifest);

  useEffect(() => {
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
