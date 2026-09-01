/**
 * @vitest-environment node
 *
 * 这一套跑在 node 环境而不是默认的 jsdom：导入 `vite.config.ts` 会连带加载 vite
 * 与 esbuild，而 esbuild 要求 `new TextEncoder().encode('') instanceof Uint8Array`
 * 为真 —— jsdom 的 TextEncoder 造的是另一个 realm 的 Uint8Array，那个断言为假，
 * esbuild 直接抛「your JavaScript environment is broken」。
 */
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

/**
 * 代理配置的断言。
 *
 * 这一套存在的理由是一个真实的漏配：起初只代理了 `/api`，而工单里的图片是
 * `/uploads/...` —— 那些请求全打在 Vite dev server 上拿 404，后台里一张图都看不见。
 * 那种问题在单测里看不出来（测试用的是 `fetch` 替身），只有真起 dev server 才发现。
 *
 * 所以这里**导入配置对象本身**来断言，而不是拿正则去扫 `vite.config.ts` 的文本 ——
 * 文本断言会被注释里的同名字符串骗过去。
 */
function proxyOf(): Record<string, { target?: string; rewrite?: (p: string) => string }> {
  // `defineConfig` 可以吃函数形式，这个配置是对象字面量 —— 断言一下，
  // 免得将来改成函数形式时这套测试静默失效。
  expect(typeof config).toBe('object');
  const server = (config as { server?: { proxy?: Record<string, never> } }).server;
  expect(server?.proxy).toBeDefined();
  return server?.proxy as ReturnType<typeof proxyOf>;
}

describe('开发期代理', () => {
  it('/api 转到服务端', () => {
    expect(proxyOf()['/api']?.target).toBe('http://localhost:3000');
  });

  /** 少了这条，`<img src="/uploads/...">` 全部 404 —— 不只是待审的那些。 */
  it('/uploads 也转到服务端', () => {
    expect(proxyOf()['/uploads']?.target).toBe('http://localhost:3000');
  });

  it('两条规则指向同一个后端', () => {
    const proxy = proxyOf();
    expect(proxy['/uploads']?.target).toBe(proxy['/api']?.target);
  });

  it('/api 的前缀会被去掉（服务端路由上没有这一段）', () => {
    expect(proxyOf()['/api']?.rewrite?.('/api/moderation/tasks')).toBe('/moderation/tasks');
  });

  /**
   * `/uploads` **不能** rewrite：服务端那条路由本身就是 `/uploads/:ownerId/:name`，
   * 去掉前缀会 404。
   *
   * 先断言那一项存在 —— 只写 `?.rewrite` 是 undefined 的话，规则整条缺失时
   * 这个断言照样通过（漏配正是本轮要防的那个 bug）。
   */
  it('/uploads 不做 rewrite', () => {
    const uploads = proxyOf()['/uploads'];
    expect(uploads).toBeDefined();
    expect(uploads?.rewrite).toBeUndefined();
  });
});
