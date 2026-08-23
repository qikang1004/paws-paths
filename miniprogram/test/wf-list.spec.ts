import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import { distributeWaterfall } from '../utils/waterfall';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const DIR = 'components/wf-list';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('wf-list 组件', () => {
  it('json 声明为组件并开启 apply-shared', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as Record<string, unknown>;
    expect(json.component).toBe(true);
    expect(json.styleIsolation).toBe('apply-shared');
  });

  it('wxml 导入卡片模板、按列渲染、模板名由属性决定', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('<import src="../../shared/card-templates.wxml"/>');
    expect(wxml).toContain('wx:for="{{columns}}"');
    expect(wxml).toContain('is="{{itemTemplate}}"');
  });

  it('列表项与相册项的 tap 绑定在 wf-list 的方法上', () => {
    const templates = read('shared/card-templates.wxml');
    expect(templates).toContain('bindtap="onItemTap"');
    expect(templates).toContain('bindtap="onPhotoTap"');
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain("triggerEvent('item-tap'");
    expect(ts).toContain("triggerEvent('photo-tap'");
  });

  it('卡片模板文件提供两个具名模板', () => {
    const templates = read('shared/card-templates.wxml');
    expect(templates).toContain('name="pet-card-tpl"');
    expect(templates).toContain('name="photo-tpl"');
  });

  it('items 变化时按 ratio 重新分列（observer 走 distributeWaterfall）', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('distributeWaterfall');
    expect(ts).toMatch(/observers/);
    // ratio 必须由组件预计算，模板才能用它撑出占位高度、消掉图片加载抖动。
    expect(ts).toMatch(/height\s*\/\s*[a-z.]*width/i);
  });

  it('占位高度由 ratio 撑起，不靠图片自身尺寸', () => {
    const templates = read('shared/card-templates.wxml');
    expect(templates).toContain('{{item.ratio *');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});

describe('distributeWaterfall 与 wf-list 的列数约定', () => {
  it('默认两列，长短不齐时短列先接新项', () => {
    const columns = distributeWaterfall(
      [
        { id: 'a', ratio: 1.6 },
        { id: 'b', ratio: 0.8 },
        { id: 'c', ratio: 0.5 },
      ],
      2,
    );
    expect(columns).toHaveLength(2);
    expect(columns[0].map((i) => i.id)).toEqual(['a']);
    expect(columns[1].map((i) => i.id)).toEqual(['b', 'c']);
  });
});
