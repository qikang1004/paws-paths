import { distributeWaterfall } from '../../utils/waterfall';

/** 页面往 item 里塞什么展示字段都行，wf-list 只认 id 与图片原始宽高。 */
interface WfListItem {
  id: string;
  width: number;
  height: number;
  [key: string]: unknown;
}

/**
 * 按原始宽高算出高宽比。宽度缺失或为 0 时退回 1（正方形占位），
 * 避免除零把整列高度算成 Infinity、把所有后续项挤到另一列。
 */
function computeRatios(items: WfListItem[]): (WfListItem & { ratio: number })[] {
  return items.map((item, index) => ({
    ...item,
    index,
    ratio: item.width > 0 ? item.height / item.width : 1,
  }));
}

/**
 * 双列瀑布流容器：不关心内容是什么，只负责分列和把点击上抛。
 * 卡片长什么样交给 shared/card-templates.wxml 里的具名模板，
 * 广场卡与详情相册因此能共用同一套分列逻辑。
 */
Component({
  properties: {
    items: { type: Array, value: [] as WfListItem[] },
    itemTemplate: { type: String, value: 'pet-card-tpl' },
    columnCount: { type: Number, value: 2 },
  },
  data: {
    columns: [] as (WfListItem & { ratio: number })[][],
  },
  observers: {
    'items, columnCount'(items: WfListItem[], columnCount: number) {
      this.setData({
        columns: distributeWaterfall(computeRatios(items ?? []), columnCount || 2),
      });
    },
  },
  methods: {
    onItemTap(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('item-tap', { id: String(e.currentTarget.dataset.id) });
    },
    onPhotoTap(e: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('photo-tap', { index: Number(e.currentTarget.dataset.index) });
    },
  },
});
