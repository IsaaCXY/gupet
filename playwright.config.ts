import {defineConfig} from '@playwright/test';

/** Electron 打包应用的端到端测试配置。 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
});
