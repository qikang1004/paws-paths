import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type ReportReason,
} from '../shared/types/index';

/**
 * 举报原因的选择数据。
 *
 * 原因是**固定白名单的单选**（`ReportReason`），不做自由文本 —— 自由文本本身是
 * 一条新的 UGC 入口，又要过一遍内容安全，本阶段不引入这条路径。
 *
 * 白名单与文案都从 `@paws/types` 来，客户端不排第二套顺序、不写第二份文案：
 * 服务端校验的正是那个数组，两边分叉的后果是用户选了个服务端不认的原因（422）。
 */

/** `wx.showActionSheet` 的 `itemList` 上限，微信官方限制。 */
export const ACTION_SHEET_MAX_ITEMS = 6;

export interface ReportReasonOption {
  reason: ReportReason;
  label: string;
}

/** 逐条对齐 `REPORT_REASONS` 的顺序 —— `reasonAt` 靠下标反查，顺序就是契约。 */
export const REPORT_REASON_OPTIONS: readonly ReportReasonOption[] = REPORT_REASONS.map(
  (reason) => ({ reason, label: REPORT_REASON_LABELS[reason] }),
);

/** action sheet 的 `itemList`，与上面同序。 */
export const REPORT_REASON_LABEL_LIST: readonly string[] = REPORT_REASON_OPTIONS.map(
  (option) => option.label,
);

/**
 * 按 action sheet 回的下标取原因。越界回 `null`。
 *
 * 刻意**不**在越界时猜一个默认原因：那会让一条本该失败的举报以「其他」的名义
 * 落库，而排查时看到的原因是错的 —— 报错的原因比报错本身更难查。
 */
export function reasonAt(index: number): ReportReason | null {
  if (!Number.isInteger(index)) return null;
  return REPORT_REASON_OPTIONS[index]?.reason ?? null;
}
