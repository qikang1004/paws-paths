import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  findBarePx,
  findHexLiterals,
  findUndefinedVars,
  listWxssFiles,
} from '../tools/style-guard';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('守卫函数本身', () => {
  it('挑出十六进制色值，注释里的不算', () => {
    expect(findHexLiterals('.a { color: #944a07; }')).toEqual(['#944a07']);
    expect(findHexLiterals('/* #944a07 */ .a { color: var(--color-primary); }')).toEqual([]);
  });

  it('挑出裸 px，rpx 与 var 不误报', () => {
    expect(findBarePx('.a { padding: 16px; }')).toEqual(['16px']);
    expect(findBarePx('.a { padding: 32rpx; margin: var(--space-md); }')).toEqual([]);
  });

  it('报出 tokens 里没定义的变量', () => {
    const tokens = 'page { --color-primary: #944a07; }';
    expect(findUndefinedVars('.a { color: var(--color-ghost); }', tokens)).toEqual([
      '--color-ghost',
    ]);
    expect(findUndefinedVars('.a { color: var(--color-primary); }', tokens)).toEqual([]);
  });
});

describe('样式表不得绕开 token 层', () => {
  const tokens = read('styles/tokens.wxss');
  const semantic = read('styles/semantic.wxss');
  const app = read('app.wxss');

  it('semantic.wxss 没有十六进制色值', () => {
    expect(findHexLiterals(semantic)).toEqual([]);
  });

  it('semantic.wxss 没有裸 px', () => {
    expect(findBarePx(semantic)).toEqual([]);
  });

  it('semantic.wxss 引用的每个变量都在 tokens.wxss 有定义', () => {
    expect(findUndefinedVars(semantic, tokens)).toEqual([]);
  });

  it('app.wxss 同样不得引用未定义变量', () => {
    expect(findUndefinedVars(app, tokens)).toEqual([]);
  });
});

// 上面那组只喂手挑的 3 个文件，components/wf-icon/index.wxss 等一直在网外；页面 wxss 现在
// 是 0 字节所以无害，但新页面写 #fff 或 16px 不会有人失败。这里改成遍历全部 wxss。
describe('全部 wxss 都不得出现 hex 字面量或裸 px（readdir 遍历，不硬编码清单）', () => {
  const ROOT = resolve(__dirname, '..');
  /**
   * styles/tokens.wxss 是 tools/build-tokens.ts 由 DESIGN.md frontmatter 生成的产物：
   * 它就是「唯一的色值来源」，按设计必须内联 hex 色值与 rpx 字面量，其余 wxss 才能
   * 只引用 var()。所以它是这条禁令的唯一豁免文件，且其新鲜度另由 build-tokens.spec.ts
   * 的产物新鲜度断言把关，不会漂移失控。
   */
  const HEX_EXEMPT = ['styles/tokens.wxss'];
  const files = listWxssFiles(ROOT);

  it('确实扫到了此前在网外的 components/wf-icon/index.wxss', () => {
    expect(files).toContain('components/wf-icon/index.wxss');
  });

  it('确实扫到了 styles / custom-tab-bar / pages 下的 wxss', () => {
    expect(files).toContain('styles/semantic.wxss');
    expect(files).toContain('custom-tab-bar/index.wxss');
    expect(files).toContain('pages/plaza/index.wxss');
  });

  it('除 tokens.wxss（生成产物，豁免）外没有任何 wxss 含 hex 字面量', () => {
    const exempt = new Set(HEX_EXEMPT);
    const offenders: string[] = [];
    for (const rel of files) {
      if (exempt.has(rel)) continue;
      const hits = findHexLiterals(readFileSync(join(ROOT, rel), 'utf8'));
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('没有任何 wxss 含裸 px（生成产物也只产出 rpx，故不豁免 px）', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const hits = findBarePx(readFileSync(join(ROOT, rel), 'utf8'));
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('豁免文件 tokens.wxss 确实含 hex（证明扫描踩在真实产物上，豁免不是空豁免）', () => {
    const tokensCss = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
    expect(findHexLiterals(tokensCss).length).toBeGreaterThan(0);
  });

  it('反向证明：给检测函数喂含 #fff 与 16px 的 wxss，两个检查都判违规（非恒真）', () => {
    const offending = '.x { color: #fff; padding: 16px; }';
    expect(findHexLiterals(offending)).toEqual(['#fff']);
    expect(findBarePx(offending)).toEqual(['16px']);
  });
});
