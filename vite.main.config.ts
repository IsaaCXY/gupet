import {defineConfig} from 'vite';

/** 主进程构建配置：保留 source map 便于定位 Electron 崩溃栈。 */
export default defineConfig({
  build: {
    sourcemap: true,
  },
});
