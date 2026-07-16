import {defineConfig} from 'vite';

/** Preload 构建配置：与主进程独立产物，保持最小 IPC 桥边界。 */
export default defineConfig({
  build: {
    sourcemap: true,
  },
});
