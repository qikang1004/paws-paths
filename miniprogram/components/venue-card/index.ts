import { buildVenueView, type VenueView } from '../../utils/venue-view';
import type { Venue } from '../../shared/types/index';

/**
 * 场所卡片（垂直列表，不走瀑布流）。传进来的是接口原样 DTO，
 * 展示字段由 buildVenueView 统一算，组件里不拼文案——列表页与详情页
 * 才不会出现两套「人均」写法。
 */
Component({
  properties: {
    // 不给 null 默认值：属性类型只接受 IAnyObject | undefined。
    venue: { type: Object, optionalTypes: [null] },
  },
  data: {
    view: null as VenueView | null,
  },
  observers: {
    venue(venue: Venue | null | undefined) {
      this.setData({ view: venue ? buildVenueView(venue) : null });
    },
  },
  methods: {
    onTap() {
      const view = this.data.view;
      if (!view) return;
      this.triggerEvent('tap', { poiId: view.poiId });
    },
  },
});
