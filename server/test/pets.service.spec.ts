import { Test } from '@nestjs/testing';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../src/common/api.exception';
import { InMemoryPetRepository, PET_REPOSITORY } from '../src/pets/pet.repository';
import { PetsService } from '../src/pets/pets.service';

describe('PetsService', () => {
  let service: PetsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PET_REPOSITORY, useClass: InMemoryPetRepository },
        PetsService,
      ],
    }).compile();
    service = moduleRef.get(PetsService);
  });

  it('list 返回 { items, hasMore, page }，page 透传，物种过滤生效', async () => {
    const res = await service.list({
      filter: { species: 'dog', breed: 'all' },
      page: 2,
      pageSize: 2,
      lat: 39.9042,
      lng: 116.4074,
    });
    expect(res.page).toBe(2);
    expect(res.items.every((i) => i.species === 'dog')).toBe(true);
    expect(typeof res.hasMore).toBe('boolean');
  });

  it('list species 非法值 → VALIDATION_FAILED', async () => {
    await expect(
      service.list({
        filter: { species: 'alien' as never, breed: 'all' },
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      service.list({
        filter: { species: 'alien' as never, breed: 'all' },
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('detail 返回 PetDetail：owner 对象、photos、personalityTags', async () => {
    const detail = await service.detail('p-1', { lat: 39.9042, lng: 116.4074 });
    expect(detail?.name).toBe('大黄');
    expect(detail?.owner.nickname).toBe('小陈');
    expect(detail?.owner.ownerVerified).toBe(true);
    expect((detail?.photos.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect(detail?.personalityTags).toContain('黏人');
  });

  it('detail 不存在 → null', async () => {
    expect(await service.detail('nope')).toBeNull();
  });

  /**
   * `isOwn`（阶段 3 Task 11）—— 客户端靠它决定关注按钮出不出现。
   *
   * 种子里 p-1 归 u-1。不传 viewerId 时恒为 false（未登录），传了才比对归属。
   */
  it('detail 的 isOwn：主人自己看是 true，别人与未登录都是 false', async () => {
    expect((await service.detail('p-1', { viewerId: 'u-1' }))?.isOwn).toBe(true);
    expect((await service.detail('p-1', { viewerId: 'u-2' }))?.isOwn).toBe(false);
    expect((await service.detail('p-1', { viewerId: null }))?.isOwn).toBe(false);
    // 不传 opts 的那条路径（`update()` 内部用它）也必须有值，不能是 undefined。
    expect((await service.detail('p-1'))?.isOwn).toBe(false);
  });

  it('detail 不下发 ownerId —— 主人的用户 id 不进公开响应', async () => {
    const detail = await service.detail('p-1', { viewerId: 'u-1' });
    expect(detail).not.toHaveProperty('ownerId');
    expect(Object.keys(detail?.owner ?? {}).sort()).toEqual([
      'avatarUrl',
      'nickname',
      'ownerVerified',
    ]);
  });

  it('list 无坐标 → 距离全 null', async () => {
    const res = await service.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: 10,
    });
    expect(res.items.every((i) => i.distanceMeters === null)).toBe(true);
  });
});
