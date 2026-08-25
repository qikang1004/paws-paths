import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { PET_REPOSITORY, type PetRepository } from '../pets/pet.repository';
import { VENUE_REPOSITORY, type VenueRepository } from '../venues/venue.repository';
import {
  FAVORITES_REPOSITORY,
  type FavoriteTargetType,
  type FavoritesRepository,
} from './favorite.repository';

/** 收藏列表条目，与 packages/types 的 FavoriteItemDto 一致。 */
export interface FavoriteItem {
  targetType: FavoriteTargetType;
  targetId: string;
  title: string;
  coverUrl: string | null;
  favoritedAt: string;
}

export interface FavoriteListResponse {
  items: FavoriteItem[];
  hasMore: boolean;
  page: number;
}

@Injectable()
export class FavoritesService {
  constructor(
    @Inject(FAVORITES_REPOSITORY) private readonly favorites: FavoritesRepository,
    @Inject(PET_REPOSITORY) private readonly pets: PetRepository,
    @Inject(VENUE_REPOSITORY) private readonly venues: VenueRepository,
  ) {}

  /**
   * 收藏/取消收藏宠物。幂等：重复调用返回同样的结果，不报错。
   *
   * 与关注不同，**收藏自己的宠物是允许的** —— 收藏是个人书签，「关注自己」才是
   * 语义上的无效操作。这里不该照抄 FOLLOW_SELF 那条 422。
   */
  async setPetFavorite(
    petId: string,
    userId: string,
    favorite: boolean,
  ): Promise<{ isFavorite: boolean }> {
    // 先确认宠物存在：target_id 没有外键，脏 id 会静默落库，之后在投影时被丢掉 ——
    // 客户端看到 200 却在收藏列表里找不到它。
    const ownerId = await this.pets.findOwnerId(petId);
    if (ownerId == null) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '宠物不存在', HttpStatus.NOT_FOUND);
    }
    return this.set(userId, 'pet', petId, favorite);
  }

  /** 场所收藏。场所 id 来自腾讯 POI，本库无从校验存在性，所以不做前置检查。 */
  async setVenueFavorite(
    poiId: string,
    userId: string,
    favorite: boolean,
  ): Promise<{ isFavorite: boolean }> {
    return this.set(userId, 'venue', poiId, favorite);
  }

  /** 单个目标是否已收藏。未登录直接 false，不打库（详情页未登录是常态）。 */
  async isFavorite(
    userId: string | null,
    targetType: FavoriteTargetType,
    targetId: string,
  ): Promise<boolean> {
    if (!userId) return false;
    const hit = await this.favorites.favoriteIds(userId, targetType, [targetId]);
    return hit.has(targetId);
  }

  /**
   * 「我的收藏」列表。pet/venue 混排，每条带 `targetType`，投影出标题与封面。
   *
   * 与浏览历史同样的取舍：目标投影不到的条目（宠物被删/转私密、场所本库没有 extras）
   * 直接丢掉 —— 半空的行在页面上就是个坏卡片。因此本页返回条数可能少于 pageSize，
   * 翻页仍以仓储的 hasMore 为准。
   */
  async list(
    userId: string,
    opts: { page: number; pageSize: number },
  ): Promise<FavoriteListResponse> {
    const { entries, hasMore } = await this.favorites.listByUser(userId, opts);
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

    const items: FavoriteItem[] = [];
    for (const { targetType, targetId, favoritedAt } of entries) {
      const common = { targetType, targetId, favoritedAt: favoritedAt.toISOString() };
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

  private async set(
    userId: string,
    targetType: FavoriteTargetType,
    targetId: string,
    favorite: boolean,
  ): Promise<{ isFavorite: boolean }> {
    if (favorite) {
      await this.favorites.add(userId, targetType, targetId);
    } else {
      await this.favorites.remove(userId, targetType, targetId);
    }
    return { isFavorite: favorite };
  }
}
