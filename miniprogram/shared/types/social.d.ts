// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
import type { AuditStatus } from './audit';
import type { PetSummary } from './pet';
/**
 * 关注列表条目。spec §4.2：关注的目标是**宠物**，不是用户 —— 一个用户可能养多只，
 * 只想看其中一只的动态是常态。
 *
 * 直接继承 {@link PetSummary} 而不是包一层 `{ pet: PetSummary }`：小程序的宠物卡
 * 组件吃的就是 `PetSummary`，扁平化后「我的关注」页能原样复用，不必解一层。
 * `id` 是宠物 id（与卡片一致，也是列表的 wx:key）。
 *
 * 刻意不带 `follows` 表的行 id：取消关注按 `(userId, petId)` 定位，列表 key 用 `id`，
 * 没有消费者，下发只会诱导客户端拿它当句柄用。
 */
export interface FollowDto extends PetSummary {
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
 * 收藏条目。spec §4.2：`favorites` 是多态的（`_2` 宠物详情的收藏心标、
 * `_3` 场所收藏），所以收藏列表是 pet/venue 混排。
 *
 * 字段刻意与 {@link ViewHistoryItemDto} 保持一致（只有时间字段名不同）：
 * 「收藏」和「浏览历史」两个页面都是混排的缩略图 + 标题 + 时间，同一个列表项
 * 组件能同时喂两份数据；形状分叉只会让客户端多写一个分支。
 */
export interface FavoriteItemDto {
    targetType: 'pet' | 'venue';
    targetId: string;
    title: string;
    coverUrl: string | null;
    favoritedAt: string;
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
