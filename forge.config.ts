import type {ForgeConfig} from '@electron-forge/shared-types';
import {MakerDMG} from '@electron-forge/maker-dmg';
import {MakerSquirrel} from '@electron-forge/maker-squirrel';
import {VitePlugin} from '@electron-forge/plugin-vite';

/** Electron Forge 的跨平台打包入口；签名信息仅从 CI 环境变量读取。 */
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
    // 生产包使用 asar；只有配置公证凭据时才启用 macOS 签名与公证。
    asar: true,
    ...(macNotarize ? {osxSign: {}, osxNotarize: macNotarize} : {}),
  },
  rebuildConfig: {},
  makers: [
    // Windows 与 macOS 必须在各自 runner 上生成对应安装包。
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
    // Vite 分别编译主进程、Preload 和 Renderer，避免 Renderer 取得 Node 能力。
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
