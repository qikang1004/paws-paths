/**
 * 图片选择器。**纯展示组件** —— 它自己不调 `wx.chooseMedia`、不上传、不知道
 * 什么叫 `auditStatus`。
 *
 * 选图与上传在 `api/media.ts` 的 `pickAndUploadImages`（那一步要拿真实宽高，
 * Global Constraint 21），页面拿到结果后把 `images` 传下来。这样发布页与
 * 宠物编辑页共用同一块 UI，而可测的逻辑全在纯函数那侧。
 *
 * 事件：`pick`（用户点了「+」，页面去选图）、`remove`（`{ index }`）。
 */
Component({
  properties: {
    /**
     * 已选好的图，只需要 `url` 一个字段；宽高由上传通道保管，这里不用。
     * 可选的 `badgeText`：非空时在格子左下角压一个角标（如审核中），
     * 文案由调用方算好传进来，组件不认识审核状态。
     */
    images: { type: Array, value: [] as { url: string; badgeText?: string }[] },
    /** 张数上限。到顶就不再显示「+」—— 点了才提示「最多 N 张」体验更差。 */
    max: { type: Number, value: 9 },
    /** 上传中：禁掉「+」与删除，避免把正在传的那张删掉后回执还回来。 */
    uploading: { type: Boolean, value: false },
  },

  data: {
    canAdd: true,
  },

  observers: {
    'images, max'(images: unknown[], max: number) {
      this.setData({ canAdd: (images?.length ?? 0) < max });
    },
  },

  methods: {
    onPick(): void {
      if (this.data.uploading) return;
      this.triggerEvent('pick');
    },

    onRemove(e: WechatMiniprogram.CustomEvent): void {
      if (this.data.uploading) return;
      // dataset 的值是字符串，不转成数字页面那侧的 splice 会拿到 '0'。
      this.triggerEvent('remove', { index: Number(e.currentTarget.dataset.index) });
    },
  },
});
