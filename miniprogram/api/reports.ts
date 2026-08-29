import type { AuditStatus, ModerationTargetType, ReportReason } from '../shared/types/index';
import { api } from './client';
import type { ApiClient } from './request';

/**
 * 内容举报（`POST /reports`）。
 *
 * 端点是**幂等**的（Global Constraint 27）：重复举报同一目标返回 200，不产生第二条
 * 工单。所以这一层不区分「新建了工单」与「早就在队列里」—— 客户端两条路走同一个
 * 分支，页面提示都是「已收到举报」。
 *
 * 举报成功后内容立刻迁到 `pending_review`，**对举报人自己也不可见了**。页面因此
 * 该把那条从列表里摘掉（`dropById`），而不是等下次刷新。
 */

/** 举报的回执。刻意不含工单 id —— 服务端不下发，举报人不该拿到运营侧的句柄。 */
export interface ReportResult {
  targetType: ModerationTargetType;
  targetId: string;
  /** 迁移后的状态。幂等分支返回的也是这个值。 */
  status: AuditStatus;
}

/**
 * 举报的共同实现。`targetType` 不开放给页面传 —— 两个具名函数各写死一个值，
 * 传错类型在服务端是 422（`MODERATION_TARGET_INVALID`），而那种错重试也没用。
 */
async function report(
  targetType: ModerationTargetType,
  targetId: string,
  reason: ReportReason,
  client: ApiClient,
): Promise<ReportResult> {
  return client.call<ReportResult>('/reports', {
    method: 'POST',
    data: { targetType, targetId, reason },
  });
}

/** 举报一条动态。 */
export async function reportPost(
  postId: string,
  reason: ReportReason,
  client: ApiClient = api,
): Promise<ReportResult> {
  return report('post', postId, reason, client);
}

/**
 * 举报动态里的**单张图片**。
 *
 * 与举报整条动态是两件事：图片与动态的审核状态独立，撤下一张图不影响文字。
 * 传的是图片自己的 id（`PostDto.images[].id`），不是动态 id。
 */
export async function reportImage(
  imageId: string,
  reason: ReportReason,
  client: ApiClient = api,
): Promise<ReportResult> {
  return report('post_image', imageId, reason, client);
}
