import type { AuditStatus } from '../../shared/types/index';
import { buildAuditBadge, type AuditBadge } from '../../utils/post-view';

/**
 * 审核角标（spec §5.3）。组件自己不判状态：显不显示、什么文案、什么色调
 * 全部由 `buildAuditBadge` 算好，这里只负责画出来 —— 页面、列表、发布页
 * 因此共用同一份口径。
 *
 * `reason` 只在「未通过」时有意义，其余状态传什么都不会渲染。
 */
Component({
  properties: {
    status: { type: String, value: 'approved' },
    reason: { type: String, optionalTypes: [null], value: '' },
  },

  data: {
    badge: buildAuditBadge('approved', null) as AuditBadge,
  },

  observers: {
    'status, reason'(status: AuditStatus, reason: string | null) {
      this.setData({ badge: buildAuditBadge(status, reason ?? null) });
    },
  },
});
