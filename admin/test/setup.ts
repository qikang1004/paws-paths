import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * 每个用例之间清干净：DOM 与 `localStorage`。
 *
 * `localStorage` 尤其要清 —— 会话就存在那里，漏清会让「未登录时显示登录页」
 * 这类断言依赖用例顺序。
 *
 * 两处都先判环境有没有 DOM：`vite-config.spec.ts` 跑在 node 环境
 * （它要导入 vite 配置，而 esbuild 在 jsdom 里起不来），那里没有
 * `localStorage` 也没有需要 cleanup 的 DOM。
 */
const hasDom = typeof window !== 'undefined';

beforeEach(() => {
  if (hasDom) localStorage.clear();
});

afterEach(() => {
  if (hasDom) cleanup();
});
