import type { AuditStatus } from './audit';

/**
 * 关注关系。spec §4.2：关注的目标是**宠物**，不是用户。
 * 一个用户可能养多只宠物，用户只想看其中一只的动态是常态。
 */
export interface FollowDto {
  id: string;
  targetPetId: string;
  petName: string;
  petCoverUrl: string | null;
  followedAt: string;
}

/** 浏览历史条目。本阶段只记宠物与场所两类。 */
export interface ViewHistoryItemDto {
  targetType: 'pet' | 'venue';
  targetId: string;
  title: string;
  coverUrl: string | null;
  viewedAt: string;
}

/**
 * 动态配图。`width`/`height` 必填：瀑布流要靠它在图片加载前算占位高度，
 * 缺了会跳版。`auditStatus` 与所属动态**独立** —— 文字过审不代表每张图都过审，
 * 单张图被驳回时其余图仍可展示。
 */
export interface PostImageDto {
  id: string;
  url: string;
  width: number;
  height: number;
  auditStatus: AuditStatus;
}

/**
 * 动态。`auditStatus` 复用统一的 {@link AuditStatus}，可见性判定一律走
 * `isVisibleTo(status, isAuthor)`，不要在业务代码里手写 `=== 'approved'`。
 */
export interface PostDto {
  id: string;
  petId: string;
  petName: string;
  content: string;
  auditStatus: AuditStatus;
  /** 仅 `rejected` 时有值，但类型上始终存在，免得客户端要做 `in` 判断。 */
  rejectReason: string | null;
  publishedAt: string;
  images: PostImageDto[];
}
