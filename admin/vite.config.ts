import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** 开发期代理的目标。两条代理规则共用，改地址只改一处。 */
const API_TARGET = process.env.ADMIN_API_TARGET ?? 'http://localhost:3000';

/**
 * 开发期把 `/api` 与 `/uploads` 都代理到本地服务端。
 *
 * 走代理而不是让前端直连 `http://localhost:3000`：那样每次开发都要先配对
 * `ADMIN_ORIGINS` 才能跨域，而代理让开发态压根不产生跨域请求。生产环境同形状 ——
 * Nginx 把这两个前缀都反代到服务端，前端代码里的路径不必随环境改。
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
      /**
       * `rewrite` 去掉 `/api` 前缀：服务端的路由是 `/auth/*`、`/moderation/*`，
       * 前缀只是前端这一侧用来区分「这是 API 不是静态资源」的约定。
       */
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      /**
       * 图片。**没有 `rewrite`** —— 服务端那条路由本身就是 `/uploads/:ownerId/:name`
       * （`UploadsController`），而工单里的 `imageUrls` 是服务端拼的相对路径
       * （`UploadsService` 的 `URL_PREFIX`）。少了这条规则，`<img src="/uploads/...">`
       * 会打到 Vite dev server 上拿 404：**所有图都是碎图，不只是待审的那些。**
       *
       * 这条代理只解决「请求打不到服务端」。待审图仍然看不到 —— 私有档只对作者
       * 本人开放（`UploadsService.fetch`），而 `<img>` 压根不会带 Authorization 头，
       * 所以运营在后台连自己的身份都递不过去。那是服务端要单独开的一条路径。
       */
      '/uploads': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
  },
});
