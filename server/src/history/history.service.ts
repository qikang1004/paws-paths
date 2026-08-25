import { Inject, Injectable, Logger } from '@nestjs/common';
import { PET_REPOSITORY, type PetRepository } from '../pets/pet.repository';
import { VENUE_REPOSITORY, type VenueRepository } from '../venues/venue.repository';
import {
  VIEW_HISTORY_REPOSITORY,
  type ViewHistoryRepository,
  type ViewTargetType,
} from './view-history.repository';

/** 列表条目，与 packages/types 的 ViewHistoryItemDto 一致。 */
export interface ViewHistoryItem {
  targetType: ViewTargetType;
  targetId: string;
  title: string;
  coverUrl: string | null;
  viewedAt: string;
}

export interface ViewHistoryListResponse {
  items: ViewHistoryItem[];
  hasMore: boolean;
  page: number;
}

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    @Inject(VIEW_HISTORY_REPOSITORY) private readonly history: ViewHistoryRepository,
    @Inject(PET_REPOSITORY) private readonly pets: PetRepository,
    @Inject(VENUE_REPOSITORY) private readonly venues: VenueRepository,
  ) {}

  /**
   * 详情页调用：记一条浏览历史，**永不抛、不阻塞响应**。
   *
   * 刻意返回 void 而不是 Promise：调用方 await 了就等于把详情页的延迟和成功率
   * 绑在一张统计表上 —— 丢一条浏览历史不值得让详情页 500 或变慢。
   * 未登录直接跳过：匿名用户没有「我的历史」。
   */
  recordSafely(userId: string | null, targetType: ViewTargetType, targetId: string): void {
    if (!userId) return;
    const warn = (err: unknown): void => {
      this.logger.warn(
        `写浏览历史失败（已忽略）${targetType}:${targetId} - ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    };
    try {
      // 仓储可能在 await 之前就同步抛（参数校验之类），所以 try/catch 与 .catch 都要有。
      void this.history.record(userId, targetType, targetId).catch(warn);
    } catch (err) {
      warn(err);
    }
  }

  /**
   * 浏览历史列表。混合类型：每条带 `targetType`，投影出标题与封面。
   *
   * 目标投影不到的条目（宠物被删/转私密、场所来自 POI 而本库没有 extras）直接丢掉 ——
   * 半空的行在页面上就是个坏卡片。因此本页返回条数可能少于 pageSize，
   * 翻页仍以仓储的 hasMore 为准。
   */
  async list(
    userId: string,
    opts: { page: number; pageSize: number },
  ): Promise<ViewHistoryListResponse> {
    const { entries, hasMore } = await this.history.list(userId, opts);
    if (entries.length === 0) return { items: [], hasMore, page: opts.page };

    const petIds = entries.filter((e) => e.targetType === 'pet').map((e) => e.targetId);
    const venueIds = entries.filter((e) => e.targetType === 'venue').map((e) => e.targetId);

    // 两类各一次批量查询，不按条目 N+1。
    const [petRows, venueRows] = await Promise.all([
      petIds.length > 0 ? this.pets.listByIds(petIds) : Promise.resolve([]),
      venueIds.length > 0 ? this.venues.listByIds(venueIds) : Promise.resolve([]),
    ]);
    const petById = new Map(petRows.map((r) => [r.id, r]));
    const venueById = new Map(venueRows.map((r) => [r.poiId, r]));

    const items: ViewHistoryItem[] = [];
    for (const { targetType, targetId, viewedAt } of entries) {
      const common = { targetType, targetId, viewedAt: viewedAt.toISOString() };
      if (targetType === 'pet') {
        const pet = petById.get(targetId);
        if (pet) items.push({ ...common, title: pet.name, coverUrl: pet.coverUrl });
      } else {
        const venue = venueById.get(targetId);
        if (venue) items.push({ ...common, title: venue.name, coverUrl: venue.curatedPhoto });
      }
    }
    return { items, hasMore, page: opts.page };
  }
}
