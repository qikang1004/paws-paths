import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findDirectWxCalls, listTsFiles, stripComments } from '../tools/wx-guard';

const ROOT = resolve(__dirname, '..');

/**
 * wx.request / wx.getLocation 的唯一合法出口。除此之外任何 .ts 源文件直呼 wx.request /
 * wx.getLocation 都视为违规——wx 是 ambient global，tsc 不拦、FakeWx 只观测得到经封装的
 * 调用，跨文件直呼在测试里完全隐形，只能靠这条遍历型守卫兜住。清单在此显式写死。
 */
const ALLOWLIST = ['api/wx-promise.ts'];

/**
 * 扫描时跳过的相对目录：
 * - test：守卫与用例本身会把 wx.request 当字符串/断言写出来，不是运行时直呼；
 * - tools：构建/上传脚本跑在 Node 里，不接触小程序 wx 运行时；
 * - shared/types：由 packages/types 同步而来的产物，不是手写源。
 *
 * `tools/` 整目录排除依赖一条约定：那里只放 Node 侧构建脚本（project.config.json 的
 * packOptions.ignore 也把它排除出包体）。若将来把小程序运行时代码误放进 tools/，这条
 * 守卫会静默漏掉它——运行时代码应放在 api/ store/ pages/ 等被扫描的目录下。
 *
 * 强度限制（lint 级）：检测只认字面直呼 `wx.request` / `wx.getLocation`，
 * 拦得住阶段 1 最可能的复制粘贴形态，但绕不过 wx['request']、const { request } = wx、
 * const w = wx; w.request()、globalThis.wx.request 这类间接写法。要兜住这些需要类型层面
 * 的引用分析，成本远高于收益，阶段 0 不做。
 */
const EXCLUDE_DIRS = ['test', 'tools', 'shared/types'];

describe('findDirectWxCalls（检测函数本身）', () => {
  it('揪出直呼全局 wx.request / wx.getLocation', () => {
    expect(findDirectWxCalls('const r = wx.request({ url });')).toEqual(['wx.request']);
    expect(findDirectWxCalls('await wx.getLocation({ type: "gcj02" });')).toEqual([
      'wx.getLocation',
    ]);
  });

  it('放过经封装的 this.wx.request / adapter.wx.getLocation（前面有 . 或标识符）', () => {
    expect(findDirectWxCalls('return this.wx.request(opts);')).toEqual([]);
    expect(findDirectWxCalls('await adapter.wx.getLocation();')).toEqual([]);
  });

  it('放过其它 wx.* 调用（只收口 request 与 getLocation 两个出口）', () => {
    expect(findDirectWxCalls('wx.login({}); wx.setStorageSync(k, v);')).toEqual([]);
  });

  it('注释里出现 wx.request 不算违规', () => {
    expect(findDirectWxCalls('// 禁止直接调 wx.request\nconst x = 1;')).toEqual([]);
    expect(findDirectWxCalls('/* 页面不要 wx.getLocation */ const y = 2;')).toEqual([]);
  });

  it('反向证明：把含违规调用的字符串喂进来，必被判违规（不是恒真断言）', () => {
    const offending = `
      export function leak() {
        wx.request({ url: '/x', method: 'GET' });
        wx.getLocation({ type: 'gcj02' });
      }
    `;
    const hits = findDirectWxCalls(offending);
    expect(hits).toContain('wx.request');
    expect(hits).toContain('wx.getLocation');
    expect(hits).toHaveLength(2);
  });
});

describe('listTsFiles（真的走 readdir，不硬编码文件清单）', () => {
  const files = listTsFiles(ROOT, EXCLUDE_DIRS);

  it('命中真实存在的源文件，且用相对 POSIX 路径', () => {
    expect(files).toContain('api/wx-promise.ts');
    expect(files).toContain('store/session.ts');
    expect(files).toContain('pages/plaza/index.ts');
  });

  it('排除 test / tools / shared/types / node_modules', () => {
    expect(files.some((f) => f.startsWith('test/'))).toBe(false);
    expect(files.some((f) => f.startsWith('tools/'))).toBe(false);
    expect(files.some((f) => f.startsWith('shared/types/'))).toBe(false);
    expect(files.some((f) => f.includes('node_modules/'))).toBe(false);
  });
});

describe('wx.request / wx.getLocation 单点出口（唯一允许封装文件 api/wx-promise.ts）', () => {
  const files = listTsFiles(ROOT, EXCLUDE_DIRS);

  it('允许清单只有 api/wx-promise.ts，且它确实存在于扫描结果里', () => {
    expect(ALLOWLIST).toEqual(['api/wx-promise.ts']);
    for (const allowed of ALLOWLIST) {
      expect(files).toContain(allowed);
    }
  });

  it('除 api/wx-promise.ts 外，没有任何 .ts 源文件直呼 wx.request / wx.getLocation', () => {
    const allow = new Set(ALLOWLIST);
    const offenders: string[] = [];
    for (const rel of files) {
      if (allow.has(rel)) continue;
      const hits = findDirectWxCalls(readFileSync(join(ROOT, rel), 'utf8'));
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    if (offenders.length > 0) {
      throw new Error(
        'wx.request / wx.getLocation 只能经 api/wx-promise.ts 收口，以下文件直呼了：\n' +
          offenders.join('\n'),
      );
    }
  });

  it('允许文件 api/wx-promise.ts 里确有 wx.request 与 wx.getLocation（证明扫描踩在真实路径上）', () => {
    const src = readFileSync(join(ROOT, 'api/wx-promise.ts'), 'utf8');
    const hits = findDirectWxCalls(src);
    expect(hits).toContain('wx.request');
    expect(hits).toContain('wx.getLocation');
  });
});

describe('stripComments', () => {
  it('删掉行注释与块注释', () => {
    expect(stripComments('a // b\nc')).toBe('a \nc');
    expect(stripComments('a /* b */ c')).toBe('a  c');
  });
});
