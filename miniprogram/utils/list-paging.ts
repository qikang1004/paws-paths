/**
 * 分页列表的两件公共事：追加下一页、判断该不该再取一页。
 *
 * 从 `pages/plaza/plaza-model.ts` 提上来的 —— 阶段 2 有五个列表页要做同一件事
 * （关注、收藏、历史、我的动态、广场）。泛型只要求条目有 `id`，因为去重就靠它。
 */
export interface PageMeta {
  page: number;
  hasMore: boolean;
}

export interface MergedPage<T> extends PageMeta {
  items: T[];
}

/**
 * 追加下一页。按 id 去重：服务端分页在数据变动时可能把同一条带进两页，
 * 重复 key 会让 wx:key 报错并渲染错乱。第一页由调用方传空 prev 实现「替换」。
 */
export function mergePage<T extends { id: string }>(
  prev: T[],
  next: T[],
  meta: PageMeta,
): MergedPage<T> {
  const seen = new Set(prev.map((item) => item.id));
  const items = [...prev];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { items, page: meta.page, hasMore: meta.hasMore };
}

/** 触底加载的闸门：有下一页且当前没有请求在飞。 */
export function shouldLoadMore(hasMore: boolean, loading: boolean): boolean {
  return hasMore && !loading;
}

/**
 * 从列表里摘掉一条。取关、取消收藏之后那一行必须当场消失 ——
 * 重新拉一整页只为了少一行，翻页位置还会跳回顶部。
 *
 * 返回新数组：`setData` 认引用，原地 `splice` 后再 `setData` 同一个引用，
 * 渲染层可能不更新。
 */
export function dropById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}
