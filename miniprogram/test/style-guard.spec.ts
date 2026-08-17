import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

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
