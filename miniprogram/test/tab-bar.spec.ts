import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ICONS } from '../components/wf-icon/icons';
import { TABS, activeIndexFor } from '../custom-tab-bar/tabs';
import { extractFrontmatter } from '../tools/build-tokens';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
  tabBar: {
    list: { pagePath: string; text: string }[];
    color: string;
    selectedColor: string;
    backgroundColor: string;
  };
};
const barCss = readFileSync(join(ROOT, 'custom-tab-bar/index.wxss'), 'utf8');
const tokensCss = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');

describe('TABS', () => {
  it('与 app.json 的 tabBar.list 顺序和文案完全一致', () => {
    expect(TABS.map((t) => ({ pagePath: t.pagePath, text: t.text }))).toEqual(app.tabBar.list);
  });

  it('每个 tab 的图标都有激活与未激活两个角色', () => {
    for (const tab of TABS) {
      expect(ICONS).toHaveProperty(`${tab.icon}:primary`);
      expect(ICONS).toHaveProperty(`${tab.icon}:on-surface-variant`);
    }
  });
});

describe('activeIndexFor', () => {
  it('带前导斜杠与不带都能命中', () => {
    expect(activeIndexFor('pages/venue-list/index')).toBe(1);
    expect(activeIndexFor('/pages/venue-list/index')).toBe(1);
  });

  it('非 tab 页面返回 -1', () => {
    expect(activeIndexFor('pages/pet-detail/index')).toBe(-1);
    expect(activeIndexFor('')).toBe(-1);
  });
});

describe('custom-tab-bar 样式', () => {
  it('没有 hex 字面量', () => {
    expect(findHexLiterals(barCss)).toEqual([]);
  });

  it('没有裸 px', () => {
    expect(findBarePx(barCss)).toEqual([]);
  });

  it('引用的 token 全部有定义', () => {
    expect(findUndefinedVars(barCss, tokensCss)).toEqual([]);
  });
});

// 自定义组件加载失败时，微信回落到原生 tabBar；这三个字段决定那一刻的观感。
// app.json 不支持 var()，只能写字面色值，取值必须与 DESIGN.md 的设计色一致。
describe('原生 tabBar 兜底配色', () => {
  const DESIGN = resolve(__dirname, '../../stitch_/paws_paths/DESIGN.md');
  const colors = extractFrontmatter(readFileSync(DESIGN, 'utf8')).colors as Record<string, string>;

  it('未选中文字用 on-surface-variant', () => {
    expect(app.tabBar.color).toBe(colors['on-surface-variant']);
  });

  it('选中文字用 primary', () => {
    expect(app.tabBar.selectedColor).toBe(colors.primary);
  });

  it('背景用 surface-container-lowest，与胶囊底色同一个 token', () => {
    expect(app.tabBar.backgroundColor).toBe(colors['surface-container-lowest']);
    expect(barCss).toContain('background-color: var(--color-surface-container-lowest);');
  });
});
