interface FilterOption {
  value: string;
  label: string;
}

/**
 * 受控筛选组件：状态由页面持有，这里只把点击翻译成 change 事件。
 * 组件内不 setData，避免出现「组件里一份、页面里一份」的双源筛选状态。
 */
Component({
  properties: {
    categories: { type: Array, value: [] as FilterOption[] },
    selected: { type: String, value: 'all' },
    subOptions: { type: Array, value: [] as FilterOption[] },
    subSelected: { type: String, value: 'all' },
  },
  methods: {
    onCategoryTap(e: WechatMiniprogram.TouchEvent) {
      const selected = String(e.currentTarget.dataset.value);
      if (selected === this.data.selected) return;
      // 换了物种，原来的品种大概率不适用了：连带重置第二层。
      this.triggerEvent('change', { selected, subSelected: 'all' });
    },
    onSubTap(e: WechatMiniprogram.TouchEvent) {
      const subSelected = String(e.currentTarget.dataset.value);
      if (subSelected === this.data.subSelected) return;
      this.triggerEvent('change', { selected: this.data.selected, subSelected });
    },
  },
});
