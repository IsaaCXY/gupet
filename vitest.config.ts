import {defineConfig} from 'vitest/config';

/** 只运行不依赖 Electron GUI 的确定性单元测试。 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      include: ['src/shared/**/*.ts', 'src/main/geometry.ts'],
    },
  },
});
