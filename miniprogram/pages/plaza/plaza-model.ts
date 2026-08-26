/**
 * 广场页的数据装配。**卡片投影与分页合并都不在这里** ——
 * 它们被提到 `utils/pet-card-view.ts` 与 `utils/list-paging.ts`，
 * 因为关注 / 收藏 / 历史 / 我的动态四个列表页要用同一份。
 *
 * 这里保留再导出（同 `pages/venue-list/venue-list-model.ts` 的写法），
 * 页面与既有测试仍按「页面模型」这一个入口引用。
 */
export { buildFeedItem, type FeedItem } from '../../utils/pet-card-view';
export {
  mergePage,
  shouldLoadMore,
  type MergedPage,
  type PageMeta,
} from '../../utils/list-paging';

import type { FeedItem } from '../../utils/pet-card-view';
import type { MergedPage } from '../../utils/list-paging';

/** 广场页的合并结果。泛型收窄到卡片类型，页面侧不必到处写 `MergedPage<FeedItem>`。 */
export type MergedFeed = MergedPage<FeedItem>;
