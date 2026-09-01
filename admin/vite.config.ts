import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * 开发期 `/api` 代理到本地服务端。
 *
 * 走代理而不是让前端直连 `http://localhost:3000`：那样每次开发都要先配对
 * `ADMIN_ORIGINS` 才能跨域，而代理让开发态压根不产生跨域请求。生产环境同形状 ——
 * Nginx 把 `/api/` 反代到服务端，前端代码里的路径不必随环境改。
 *
 * `rewrite` 去掉 `/api` 前缀：服务端的路由是 `/auth/*`、`/moderation/*`，
 * 前缀只是前端这一侧用来区分「这是 API 不是静态资源」的约定。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /**
       * `@paws/types` 指到**源码**而不是 `dist`。
       *
       * 那个包编译成 CommonJS（`tsconfig.base.json` 里 `module: CommonJS`，服务端
       * 与小程序都要它这么出），而它的 `index.js` 用 `__exportStar` 转发子模块 ——
       * 那是运行期行为，Rollup 静态分析不出有哪些具名导出，打包会报
       * 「ERROR_CODES is not exported」。
       *
       * 指到源码让 Vite 自己编 TS，顺带免掉「改了类型要先 build 一次才生效」。
       * 服务端那侧不受影响：它照旧 require `dist`。
       */
      '@paws/types': fileURLToPath(new URL('../packages/types/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.ADMIN_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
  },
});
