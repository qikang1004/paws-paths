import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const DIR = 'components/filter-chips';
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('filter-chips 组件', () => {
  it('json 声明为组件并开启 apply-shared', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as Record<string, unknown>;
    expect(json.component).toBe(true);
    expect(json.styleIsolation).toBe('apply-shared');
  });

  it('两层都绑定各自的 tap 处理器', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('bindtap="onCategoryTap"');
    expect(wxml).toContain('bindtap="onSubTap"');
  });

  it('第二层在没有品种可选时整块不渲染', () => {
    expect(read(`${DIR}/index.wxml`)).toContain('wx:if="{{subOptions.length}}"');
  });

  it('选中态由 selected / subSelected 决定', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('selected === item.value');
    expect(wxml).toContain('subSelected === item.value');
  });

  it('点第一层重置第二层为 all 后再上抛 change', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain("triggerEvent('change'");
    expect(ts).toMatch(/subSelected:\s*'all'/);
  });

  it('受控组件：不自持筛选状态，只读 properties 后上抛', () => {
    const ts = read(`${DIR}/index.ts`);
    // 匹配调用形式而不是裸字符串：文件里的注释也解释了「不 setData」这件事，
    // 用 this.setData( 才能只盯住真正的写状态动作。
    expect(ts).not.toContain('this.setData(');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, read('styles/tokens.wxss'))).toEqual([]);
  });
});
