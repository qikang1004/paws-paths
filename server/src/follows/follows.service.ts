import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { PET_REPOSITORY, type PetRepository } from '../pets/pet.repository';
import { toSummary, type PetSummary } from '../pets/pets.service';
import { FOLLOW_REPOSITORY, type FollowRepository } from './follow.repository';

/** 关注列表条目：宠物卡的扁平扩展，与 packages/types 的 FollowDto 一致。 */
export interface FollowItem extends PetSummary {
  followedAt: string;
}

export interface FollowListResponse {
  items: FollowItem[];
  hasMore: boolean;
  page: number;
}

@Injectable()
export class FollowsService {
  constructor(
    @Inject(FOLLOW_REPOSITORY) private readonly follows: FollowRepository,
    @Inject(PET_REPOSITORY) private readonly pets: PetRepository,
  ) {}

  /**
   * 关注/取消关注。幂等：重复调用返回同样的结果，不报错。
   *
   * 取消关注自己的宠物也报 FOLLOW_SELF 而不是静默成功：这条关系本来就不该存在，
   * 静默成功会让「关注自己」的 bug 在客户端表现为一切正常。
   */
  async setFollow(
    petId: string,
    userId: string,
    follow: boolean,
  ): Promise<{ isFollowing: boolean }> {
    const ownerId = await this.pets.findOwnerId(petId);
    if (ownerId == null) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '宠物不存在', HttpStatus.NOT_FOUND);
    }
    if (ownerId === userId) {
      throw new ApiException(
        ERROR_CODES.FOLLOW_SELF,
        undefined,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (follow) {
      await this.follows.follow(userId, petId);
    } else {
      await this.follows.unfollow(userId, petId);
    }
    return { isFollowing: follow };
  }

  async listFollowing(
    userId: string,
    opts: { page: number; pageSize: number; lat?: number; lng?: number },
  ): Promise<FollowListResponse> {
    const { petIds, hasMore } = await this.follows.listFollowing(userId, opts);
    if (petIds.length === 0) return { items: [], hasMore, page: opts.page };

    const coords =
      typeof opts.lat === 'number' && typeof opts.lng === 'number'
        ? { lat: opts.lat, lng: opts.lng }
        : undefined;
    // 卡片投影复用 PetRepository，不在这里重写一份 SQL。
    const rows = await this.pets.listByIds(petIds, coords);
    const followedAt = await this.follows.followedAtByPetId(userId, petIds);

    // rows 的 id 是 petIds 的子集，而 petIds 全部来自 follows 表，
    // 所以 followedAt 一定有值；断言不到就是仓储实现坏了，宁可显式报错。
    const items = rows.map<FollowItem>((row) => {
      const at = followedAt.get(row.id);
      if (at == null) throw new Error(`关注时间缺失：${row.id}`);
      return { ...toSummary(row), isFollowing: true, followedAt: at.toISOString() };
    });
    return { items, hasMore, page: opts.page };
  }

  /**
   * 批量标记 isFollowing。未登录或空列表直接返回，不打库 ——
   * 广场页未登录是常态，不该为此多一次查询。
   */
  async markFollowing<T extends { id: string }>(
    items: T[],
    userId: string | null,
  ): Promise<(T & { isFollowing: boolean })[]> {
    if (!userId || items.length === 0) {
      return items.map((item) => ({ ...item, isFollowing: false }));
    }
    const following = await this.follows.followingPetIds(
      userId,
      items.map((i) => i.id),
    );
    return items.map((item) => ({ ...item, isFollowing: following.has(item.id) }));
  }
}
