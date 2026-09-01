import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * 每个用例之间清干净：DOM、`localStorage`、以及被替身过的 `fetch`。
 *
 * `localStorage` 尤其要清 —— 会话就存在那里，漏清会让「未登录时显示登录页」
 * 这类断言依赖用例顺序。
 */
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});
