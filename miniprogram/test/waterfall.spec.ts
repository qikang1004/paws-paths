import { distributeWaterfall, type WaterfallItem } from '../utils/waterfall';

const item = (id: string, ratio: number): WaterfallItem => ({ id, ratio });

describe('distributeWaterfall', () => {
  it('空数组 → 按列数返回空列', () => {
    expect(distributeWaterfall([], 2)).toEqual([[], []]);
  });

  it('等高图均分两列，累计高度相等', () => {
    const cols = distributeWaterfall(
      [item('a', 1), item('b', 1), item('c', 1), item('d', 1)],
      2,
    );
    expect(cols[0].length).toBe(2);
    expect(cols[1].length).toBe(2);
    const sum = (c: WaterfallItem[]) => c.reduce((acc, i) => acc + i.ratio, 0);
    expect(sum(cols[0])).toBe(sum(cols[1]));
  });

  it('高图独占一列，矮图叠进另一列', () => {
    const cols = distributeWaterfall([item('tall', 9), item('s1', 1), item('s2', 1)], 2);
    expect(cols[0].map((i) => i.id)).toEqual(['tall']);
    expect(cols[1].map((i) => i.id)).toEqual(['s1', 's2']);
  });

  it('单列时全部按输入顺序进同一列', () => {
    const cols = distributeWaterfall([item('a', 2), item('b', 1)], 1);
    expect(cols.length).toBe(1);
    expect(cols[0].map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('等高时按输入顺序依次进列（分配稳定可预期）', () => {
    const cols = distributeWaterfall(
      [item('a', 1), item('b', 1), item('c', 1), item('d', 1)],
      2,
    );
    expect(cols[0].map((i) => i.id)).toEqual(['a', 'c']);
    expect(cols[1].map((i) => i.id)).toEqual(['b', 'd']);
  });
});
