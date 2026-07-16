import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

/** Renderer 构建配置；相对资源路径使 asar 内加载 Pet 图集保持可用。 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    sourcemap: true,
  },
});
