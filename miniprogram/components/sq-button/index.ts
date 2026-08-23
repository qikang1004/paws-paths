Component({
  properties: {
    type: { type: String, value: 'primary' },
    size: { type: String, value: 'md' },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
  },
  methods: {
    onTap() {
      // 禁用或加载中就把事件吃掉：重复提交比按钮没反应更难收拾。
      if (this.data.disabled || this.data.loading) return;
      this.triggerEvent('tap');
    },
  },
});
