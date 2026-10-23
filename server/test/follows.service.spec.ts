import { Test } from '@nestjs/testing';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../src/common/api.exception';
import {
  FOLLOW_REPOSITORY,
  InMemoryFollowRepository,
} from '../src/follows/follow.repository';
import { FollowsService } from '../src/follows/follows.service';
import { InMemoryPetRepository, PET_REPOSITORY } from '../src/pets/pet.repository';
import { PetsService } from '../src/pets/pets.service';
import { UploadsService } from '../src/uploads/uploads.service';

describe('FollowsService', () => {
  let service: FollowsService;
  // seed：p-1 属 u-1，p-2 属 u-2。u-1 关注 p-2 合法，关注 p-1 是关注自己的宠物。
  const OWNER_OF_P1 = 'u-1';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: FOLLOW_REPOSITORY, useClass: InMemoryFollowRepository },
        { provide: PET_REPOSITORY, useClass: InMemoryPetRepository },
        // PetsService 加照片时要按档定审核状态；关注流程用不到，给个空替身。
        { provide: UploadsService, useValue: { laneOfUrl: async () => null } },
        PetsService,
        FollowsService,
      ],
    }).compile();
    service = moduleRef.get(FollowsService);
  });

  it('关注返回 { isFollowing: true }，重复关注仍 true（幂等）', async () => {
    expect(await service.setFollow('p-2', OWNER_OF_P1, true)).toEqual({ isFollowing: true });
    expect(await service.setFollow('p-2', OWNER_OF_P1, true)).toEqual({ isFollowing: true });
    const list = await service.listFollowing(OWNER_OF_P1, { page: 1, pageSize: 20 });
    expect(list.items).toHaveLength(1);
  });

  it('取消关注返回 { isFollowing: false }，重复取消不报错', async () => {
    await service.setFollow('p-2', OWNER_OF_P1, true);
    expect(await service.setFollow('p-2', OWNER_OF_P1, false)).toEqual({ isFollowing: false });
    expect(await service.setFollow('p-2', OWNER_OF_P1, false)).toEqual({ isFollowing: false });
  });

  it('关注自己的宠物 → FOLLOW_SELF', async () => {
    await expect(service.setFollow('p-1', OWNER_OF_P1, true)).rejects.toMatchObject({
      code: ERROR_CODES.FOLLOW_SELF,
    });
  });

  it('取消关注自己的宠物也拦 —— 本来就不该存在这条关系', async () => {
    await expect(service.setFollow('p-1', OWNER_OF_P1, false)).rejects.toMatchObject({
      code: ERROR_CODES.FOLLOW_SELF,
    });
  });

  it('关注不存在的宠物 → NOT_FOUND（在库层外键报错之前拦住）', async () => {
    await expect(service.setFollow('p-nope', OWNER_OF_P1, true)).rejects.toBeInstanceOf(
      ApiException,
    );
    await expect(service.setFollow('p-nope', OWNER_OF_P1, true)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('listFollowing 返回宠物卡数组，按关注时间倒序，带 isFollowing: true', async () => {
    await service.setFollow('p-2', OWNER_OF_P1, true);
    await service.setFollow('p-3', OWNER_OF_P1, true);
    const { items, hasMore, page } = await service.listFollowing(OWNER_OF_P1, {
      page: 1,
      pageSize: 20,
    });
    expect(items.map((i) => i.id)).toEqual(['p-3', 'p-2']);
    expect(items[0].name).toBe('可乐');
    // 自己关注列表里的每一项当然都是已关注
    expect(items.every((i) => i.isFollowing)).toBe(true);
    expect(items[0].followedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 不下发 follows 表的行 id：取消关注按 (userId, petId) 定位，没人用得上它
    expect(items[0]).not.toHaveProperty('followId');
    expect(hasMore).toBe(false);
    expect(page).toBe(1);
  });

  it('listFollowing 无坐标 → distanceMeters 全 null（沿用阶段 1 城市模式）', async () => {
    await service.setFollow('p-2', OWNER_OF_P1, true);
    const { items } = await service.listFollowing(OWNER_OF_P1, { page: 1, pageSize: 20 });
    expect(items.every((i) => i.distanceMeters === null)).toBe(true);
  });

  it('listFollowing 带坐标 → distanceMeters 非 null', async () => {
    await service.setFollow('p-2', OWNER_OF_P1, true);
    const { items } = await service.listFollowing(OWNER_OF_P1, {
      page: 1,
      pageSize: 20,
      lat: 39.9042,
      lng: 116.4074,
    });
    expect(items[0].distanceMeters).not.toBeNull();
  });

  it('listFollowing 分页生效', async () => {
    for (const id of ['p-2', 'p-3', 'p-4', 'p-5']) {
      await service.setFollow(id, OWNER_OF_P1, true);
    }
    const first = await service.listFollowing(OWNER_OF_P1, { page: 1, pageSize: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await service.listFollowing(OWNER_OF_P1, { page: 2, pageSize: 3 });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it('未关注任何宠物 → 空数组而不是报错', async () => {
    const { items, hasMore } = await service.listFollowing('u-9', { page: 1, pageSize: 20 });
    expect(items).toEqual([]);
    expect(hasMore).toBe(false);
  });

  it('markFollowing：未登录时全部 false，不打库', async () => {
    const marked = await service.markFollowing(
      [{ id: 'p-2' }, { id: 'p-3' }],
      null,
    );
    expect(marked.every((m) => m.isFollowing === false)).toBe(true);
  });

  it('markFollowing：登录态批量标记，只有关注过的为 true', async () => {
    await service.setFollow('p-3', OWNER_OF_P1, true);
    const marked = await service.markFollowing(
      [{ id: 'p-2' }, { id: 'p-3' }],
      OWNER_OF_P1,
    );
    expect(marked.map((m) => m.isFollowing)).toEqual([false, true]);
  });

  it('markFollowing：空列表回空，不打库', async () => {
    expect(await service.markFollowing([], OWNER_OF_P1)).toEqual([]);
  });
});
