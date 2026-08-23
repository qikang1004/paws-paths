export interface WaterfallItem {
  id: string;
  /** 高宽比（height / width），决定这张图在列里占多高。 */
  ratio: number;
}

/**
 * 瀑布流分列：每项进入当前累计高度最矮的一列，等高时取靠左的列，
 * 因此相同 ratio 的项会按输入顺序依次铺开，分配稳定可预期。
 */
export function distributeWaterfall(
  items: WaterfallItem[],
  columnCount: number,
): WaterfallItem[][] {
  const count = Math.max(1, Math.floor(columnCount));
  const columns: WaterfallItem[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);

  for (const item of items) {
    let target = 0;
    for (let i = 1; i < count; i += 1) {
      if (heights[i] < heights[target]) target = i;
    }
    columns[target].push(item);
    heights[target] += item.ratio;
  }
  return columns;
}
