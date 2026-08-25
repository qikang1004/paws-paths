import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe.each(['sq-button', 'empty-state', 'audit-badge'])('%s 组件配置', (name) => {
  const dir = `components/${name}`;

  it('json 声明为组件并开启 apply-shared（语义类与 token 才进得来）', () => {
    const json = JSON.parse(read(`${dir}/index.json`)) as Record<string, unknown>;
    expect(json.component).toBe(true);
    expect(json.styleIsolation).toBe('apply-shared');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${dir}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});

describe('sq-button', () => {
  it('wxml 绑定 tap 处理器', () => {
    expect(read('components/sq-button/index.wxml')).toContain('bindtap="onTap"');
  });

  it('禁用与加载中不上抛 tap', () => {
    const ts = read('components/sq-button/index.ts');
    expect(ts).toMatch(/disabled|loading/);
    expect(ts).toContain("triggerEvent('tap'");
  });

  it('四种类型与两种尺寸都有对应样式', () => {
    const css = read('components/sq-button/index.wxss');
    for (const type of ['primary', 'plain', 'danger', 'ghost']) {
      expect(css).toContain(`.sq-button--${type}`);
    }
    for (const size of ['md', 'lg']) {
      expect(css).toContain(`.sq-button--${size}`);
    }
  });
});

describe('empty-state', () => {
  it('渲染标题与提示，并用 wf-icon 出图', () => {
    const wxml = read('components/empty-state/index.wxml');
    expect(wxml).toContain('{{title}}');
    expect(wxml).toContain('{{hint}}');
    expect(wxml).toContain('wf-icon');
  });

  it('json 里声明了 wf-icon 依赖', () => {
    const json = JSON.parse(read('components/empty-state/index.json')) as {
      usingComponents?: Record<string, string>;
    };
    expect(json.usingComponents?.['wf-icon']).toBeTruthy();
  });
});

/**
 * 角标组件不许自己判状态：文案与显不显示全由 `buildAuditBadge` 算好，
 * 组件只负责把结果画出来。散落的 `status === 'approved'` 正是 spec §4.5
 * 要禁的东西（服务端有 audit-literal-guard 拦，小程序侧靠这条守住）。
 */
describe('audit-badge', () => {
  it('wxml 只读预算好的 badge 字段，不比状态字面量', () => {
    const wxml = read('components/audit-badge/index.wxml');
    expect(wxml).toContain('{{badge.visible}}');
    expect(wxml).toContain('{{badge.text}}');
    expect(wxml).toContain('{{badge.reasonText}}');
    expect(wxml).not.toMatch(/approved|pending|rejected/);
  });

  it('状态判定走 buildAuditBadge，组件里没有字面量比较', () => {
    const ts = read('components/audit-badge/index.ts');
    expect(ts).toContain('buildAuditBadge');
    expect(ts).not.toMatch(/===\s*'(approved|pending|pending_review|rejected)'/);
  });

  it('两种 tone 各有一套样式', () => {
    const css = read('components/audit-badge/index.wxss');
    expect(css).toContain('.audit-badge--pending');
    expect(css).toContain('.audit-badge--rejected');
  });
});
