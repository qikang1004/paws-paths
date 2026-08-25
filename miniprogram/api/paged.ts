/**
 * 分页的共同形状。服务端所有列表端点都回 `{ items, hasMore, page }`
 * （`me.controller.ts` / `posts.controller.ts` 都是这个信封里的 data），
 * 所以客户端只需要一份泛型，不必每个域各写一遍。
 *
 * 刻意留在 api 层而不是塞进 `shared/types`：那份是 `packages/types` 同步过来的，
 * 手改会被 `sync-types` guard 拦下，而这个形状是客户端读法上的便利，
 * 不是服务端契约里新增的 DTO。
 */
export interface PageParams {
  page: number;
  pageSize: number;
}

export interface PagedResponse<T> {
  items: T[];
  hasMore: boolean;
  page: number;
}
