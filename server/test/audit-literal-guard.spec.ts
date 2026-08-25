import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isVisibleTo } from '@paws/types';

const SRC = resolve(__dirname, '..', 'src');

/**
 * 审核状态字面量守卫。
 *
 * spec §4.5：`pet_photos` / `posts` / `post_images` / `messages` / `pet_licenses`
 * 共用一套状态机，判定逻辑的唯一出口是 `@paws/types` 的 `canTransition` /
 * `isVisibleTo`。业务代码里手写 `status === 'approved'` 是违规的 —— 阶段 3/4
 * 还要接入 messages 与 pet_licenses，散落的字面量迟早会在某条新路径上漏掉过滤，
 * 而「未 approved 对他人不可见」是小程序过审的必要条件。
 *
 * SQL 里的状态字面量不在管辖范围内（`WHERE audit_status = 'approved'` 没法用
 * TS 函数表达）。下面的正则只匹配 `===` / `!==` / `==` / `!=` 这类 TS 比较，
 * SQL 的单个 `=` 天然不会命中，所以不需要维护豁免清单。
 */

/** 只扫 .ts。schema.sql / seed.sql 里的 CHECK 约束必须写字面量，不扫。 */
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const STATUSES = 'pending|approved|pending_review|rejected';

/** TS 层比较：状态字面量出现在 === / !== / == / != 的任意一侧。 */
const TS_COMPARISON = new RegExp(
  `[=!]==?\\s*['"](?:${STATUSES})['"]|['"](?:${STATUSES})['"]\\s*[=!]==?`,
);

describe('审核状态字面量守卫', () => {
  const files = listTsFiles(SRC);

  it('扫到了 server/src 下的 TS 文件（守卫本身不能空跑）', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('业务代码不手写状态比较，一律走 @paws/types 的判定函数', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (TS_COMPARISON.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(SRC, file).replace(/\\/g, '/'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('正则确实能抓到违规写法（守卫不能是永真的）', () => {
    // 这几种都该被拦下
    for (const bad of [
      `if (post.auditStatus === 'approved') return post;`,
      `if (status !== 'pending') skip();`,
      `const visible = 'approved' === row.audit_status;`,
    ]) {
      expect(TS_COMPARISON.test(bad)).toBe(true);
    }
  });

  it('SQL 里的单个 = 不被误判（仓储层要能写 WHERE 子句）', () => {
    const sql = `SELECT * FROM posts WHERE audit_status = 'approved' ORDER BY published_at DESC`;
    expect(TS_COMPARISON.test(sql)).toBe(false);
  });

  it('判定函数确实可从 @paws/types 取到（守卫的前提）', () => {
    // 守卫要求大家改用这个函数，那它必须真的存在且语义正确
    expect(isVisibleTo('approved', false)).toBe(true);
    expect(isVisibleTo('pending', false)).toBe(false);
    expect(isVisibleTo('pending', true)).toBe(true);
  });
});
