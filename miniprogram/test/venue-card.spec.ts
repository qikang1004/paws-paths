import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const DIR = 'components/venue-card';
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('venue-card 组件', () => {
  it('json 声明为组件并开启 apply-shared', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as Record<string, unknown>;
    expect(json.component).toBe(true);
    expect(json.styleIsolation).toBe('apply-shared');
  });

  it('点击上抛 poiId，交给页面决定跳哪', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain("triggerEvent('tap'");
    expect(ts).toContain('poiId');
    expect(read(`${DIR}/index.wxml`)).toContain('bindtap="onTap"');
  });

  it('extras 缺失时评分、人均、封面都不渲染（降级不留空洞）', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('wx:if="{{view.showRating}}"');
    expect(wxml).toContain('wx:if="{{view.showPrice}}"');
    expect(wxml).toContain('wx:if="{{view.coverUrl}}"');
  });

  it('渲染名称、地址、类目标签与距离', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('{{view.name}}');
    expect(wxml).toContain('{{view.address}}');
    expect(wxml).toContain('{{view.ratingText}}');
    expect(wxml).toContain('{{view.priceText}}');
    expect(wxml).toContain('wx:if="{{view.distanceText}}"');
    expect(wxml).toContain('chip--sm');
  });

  it('展示字段由 venue-list-model 统一算，组件内不自己拼文案', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('buildVenueView');
    expect(ts).not.toContain('人均 ¥');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
