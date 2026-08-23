import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  OUTSIDE_PAGE_SLOTS,
  findBarePx,
  findHexLiterals,
  findTokensInaccessibleOutsidePage,
  findUndefinedVars,
  listWxssFiles,
  parseTokenScopes,
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

// findUndefinedVars 只做「名字存在性」检查，看不到作用域：若 token 只声明在 page {}
// 下、组件却渲染在 page 子树之外（custom-tab-bar / 自定义导航栏），它照样放行。
// 下面是选择器感知的补层：token 必须至少有一个非 page 作用域（如 .token-scope）的定义。
describe('parseTokenScopes：把选择器组拆成独立作用域', () => {
  it('分组选择器 page, .token-scope 拆成两个作用域', () => {
    expect(parseTokenScopes('page, .token-scope { --a: 1; }')).toEqual([
      { selector: 'page', tokens: ['--a'] },
      { selector: '.token-scope', tokens: ['--a'] },
    ]);
  });

  it('注释里的声明不算（tokens.wxss 顶部就有说明注释）', () => {
    expect(parseTokenScopes('/* page { --x: 1; } */ .token-scope { --b: 2; }')).toEqual([
      { selector: '.token-scope', tokens: ['--b'] },
    ]);
  });

  it('空声明块不产生作用域', () => {
    expect(parseTokenScopes('page {}')).toEqual([]);
  });
});

describe('findTokensInaccessibleOutsidePage：page 子树外的组件拿不到只挂 page 下的 token', () => {
  it('只挂在 page 下的 token 判为不可达', () => {
    const tokens = 'page { --a: 1; } .token-scope { --b: 2; }';
    expect(findTokensInaccessibleOutsidePage(tokens, '.x { color: var(--a); }')).toEqual(['--a']);
  });

  it('挂在 .token-scope 下的 token 可达', () => {
    const tokens = 'page { --a: 1; } .token-scope { --b: 2; }';
    expect(findTokensInaccessibleOutsidePage(tokens, '.x { color: var(--b); }')).toEqual([]);
  });

  it('分组选择器 page, .token-scope 声明的 token 对子树外组件可达', () => {
    const tokens = 'page, .token-scope { --a: 1; }';
    expect(findTokensInaccessibleOutsidePage(tokens, '.x { color: var(--a); }')).toEqual([]);
  });

  it('类名里带 page 的选择器不算 page 作用域（.page-gutter 不该被误判）', () => {
    const tokens = '.page-gutter { --a: 1; }';
    expect(findTokensInaccessibleOutsidePage(tokens, '.x { color: var(--a); }')).toEqual([]);
  });

  it('未在任何作用域定义的 token 同样判为不可达', () => {
    const tokens = 'page { --a: 1; }';
    expect(findTokensInaccessibleOutsidePage(tokens, '.x { color: var(--ghost); }')).toEqual([
      '--ghost',
    ]);
  });

  it('反向证明：consumer 只引用 token，作用域拆分不是恒真', () => {
    const tokens = 'page { --a: 1; }';
    expect(findTokensInaccessibleOutsidePage(tokens, '.x { color: var(--a); }')).toEqual(['--a']);
    expect(findTokensInaccessibleOutsidePage(tokens, '.x { color: var(--b); }')).toEqual(['--b']);
  });
});

describe('page 子树外的框架组件槽位（custom-*）不得引用只挂 page 下的 token', () => {
  const tokens = read('styles/tokens.wxss');
  const ROOT = resolve(__dirname, '..');
  const slotFiles = listWxssFiles(ROOT).filter((rel) =>
    OUTSIDE_PAGE_SLOTS.some((slot) => rel.startsWith(`${slot}/`)),
  );

  it('槽位清单覆盖 custom-tab-bar（现在的唯一 page 外组件）', () => {
    expect(slotFiles).toContain('custom-tab-bar/index.wxss');
  });

  it('槽位里每个 wxss 引用的 token 都在非 page 作用域有定义', () => {
    const offenders: string[] = [];
    for (const rel of slotFiles) {
      const hits = findTokensInaccessibleOutsidePage(tokens, readFileSync(join(ROOT, rel), 'utf8'));
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('反向证明：若 tokens 把 token 收回 page 下，真实 custom-tab-bar 样式会被判违规', () => {
    const barCss = readFileSync(join(ROOT, 'custom-tab-bar/index.wxss'), 'utf8');
    const pageOnlyTokens = 'page { --a: 1; }';
    expect(findTokensInaccessibleOutsidePage(pageOnlyTokens, barCss).length).toBeGreaterThan(0);
  });
});
