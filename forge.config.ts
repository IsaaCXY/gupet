import type {ForgeConfig} from '@electron-forge/shared-types';
import {MakerDMG} from '@electron-forge/maker-dmg';
import {MakerSquirrel} from '@electron-forge/maker-squirrel';
import {VitePlugin} from '@electron-forge/plugin-vite';

const windowsSigning =
  process.env.WINDOWS_CERTIFICATE_FILE && process.env.WINDOWS_CERTIFICATE_PASSWORD
    ? {
        certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
      }
    : {};

const macNotarize =
  process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    ...(macNotarize ? {osxSign: {}, osxNotarize: macNotarize} : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel(
      {
        name: 'desktop_pet',
        ...windowsSigning,
      },
      ['win32'],
    ),
    new MakerDMG(
      {
        format: 'ULFO',
      },
      ['darwin'],
    ),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
