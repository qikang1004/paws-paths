import { API_BASE_URL } from '../config';
import { isPubliclyVisible, type AuditStatus, type PostDto } from '../shared/types/index';
import { formatPostTime } from './format';
import { resolveImageUrl } from './image-url';

/**
 * 审核角标与动态视图的唯一口径。
 *
 * 放在 `utils/` 是为了让 `audit-badge` 组件、动态列表页、发布页共用同一份实现 ——
 * 只要有第二处自己判状态，「未 approved 对他人不可见」这条过审必要条件迟早
 * 会在某个页面上漏掉。业务代码一律不写 `status === 'approved'`（spec §4.5）。
 */

export type AuditBadgeTone = 'pending' | 'rejected';

export interface AuditBadge {
  /** 显不显示。从状态机的 `isPubliclyVisible` 派生，不另立一套判断。 */
  visible: boolean;
  text: string;
  tone: AuditBadgeTone;
  /** 驳回原因那一行显不显示。服务端没给原因时为 false，免得渲染出一条空行。 */
  showReason: boolean;
  reasonText: string;
}

/**
 * 角标文案查表。approved 那格是空串 —— 它压根不显示角标，
 * 但表里必须有这一格：`Record<AuditStatus, …>` 让「将来加一种状态」变成编译错误，
 * 而不是在页面上渲染出一个 undefined。
 */
const BADGE_TEXT: Readonly<Record<AuditStatus, string>> = {
  approved: '',
  pending: '审核中',
  // 被举报撤下待人工复核。对作者显示的措辞与 pending 一致：
  // 「你的内容正在被复核」，不必把「有人举报了你」摊开说。
  pending_review: '审核中',
  rejected: '未通过',
};

const BADGE_TONE: Readonly<Record<AuditStatus, AuditBadgeTone>> = {
  approved: 'pending',
  pending: 'pending',
  pending_review: 'pending',
  rejected: 'rejected',
};

export function buildAuditBadge(status: AuditStatus, rejectReason: string | null): AuditBadge {
  const visible = !isPubliclyVisible(status);
  const tone = BADGE_TONE[status];
  const reason = (rejectReason ?? '').trim();
  // 只有「未通过」才配原因。空白字符不算原因 —— 那会渲染出一条什么都没有的行。
  const showReason = visible && tone === 'rejected' && reason.length > 0;
  return {
    visible,
    text: visible ? BADGE_TEXT[status] : '',
    tone,
    showReason,
    reasonText: showReason ? reason : '',
  };
}

/** 视图里的图片：地址已补全，宽高原样留给瀑布流算占位高度。 */
export interface PostImageView {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface PostView {
  id: string;
  petId: string;
  petName: string;
  content: string;
  auditStatus: AuditStatus;
  badge: AuditBadge;
  timeText: string;
  images: PostImageView[];
  hasImages: boolean;
}

export interface BuildPostViewOptions {
  /** 图片地址的 base。默认接口 base，测试注入固定值。 */
  baseUrl?: string;
  /** 相对时间的基准。默认当前时刻，测试注入固定值。 */
  now?: number;
}

/**
 * 从某条动态里摘掉一张图，并重算 `hasImages`。
 *
 * 举报**单张图片**成功后用它 —— 与举报整条动态不同：图片与动态的审核状态独立
 * （`post_images` 有自己的 `audit_status`），撤下一张图不影响文字，所以动态本身
 * 必须留在列表里。用 `dropById` 会把整条删掉。
 *
 * 重算 `hasImages` 是关键的一半：摘掉最后一张时那个标志必须翻成 false，
 * 否则 wxml 里 `wx:if="{{item.hasImages}}"` 会渲染出一个空的图片容器。
 *
 * 返回新数组、新对象（不原地改）：`setData` 认引用，原地改后再 setData
 * 同一个引用，渲染层可能不更新 —— 同 `dropById` 的理由。
 * 找不到目标时原样返回，**不静默清空**：id 对不上说明调用方拿错了，
 * 把整条动态的图清掉会让那次错误看起来像「举报成功了」。
 */
export function dropImageById(posts: PostView[], postId: string, imageId: string): PostView[] {
  return posts.map((post) => {
    if (post.id !== postId) return post;
    const images = post.images.filter((image) => image.id !== imageId);
    if (images.length === post.images.length) return post;
    return { ...post, images, hasImages: images.length > 0 };
  });
}

/**
 * 动态 → 视图。wxml 里不做判断，全部在这里算好。
 *
 * 刻意**不**再按可见性筛一遍图片：服务端 `toDto` 已经把这个人看不到的图筛掉了，
 * 客户端再判一次就是第二份判定，两处迟早分叉 —— 而服务端那份才是安全边界。
 */
export function buildPostView(post: PostDto, opts: BuildPostViewOptions = {}): PostView {
  const baseUrl = opts.baseUrl ?? API_BASE_URL;
  const images = post.images.map((image) => ({
    id: image.id,
    url: resolveImageUrl(image.url, baseUrl),
    width: image.width,
    height: image.height,
  }));
  return {
    id: post.id,
    petId: post.petId,
    petName: post.petName,
    content: post.content,
    auditStatus: post.auditStatus,
    badge: buildAuditBadge(post.auditStatus, post.rejectReason),
    timeText: formatPostTime(post.publishedAt, opts.now),
    images,
    hasImages: images.length > 0,
  };
}
