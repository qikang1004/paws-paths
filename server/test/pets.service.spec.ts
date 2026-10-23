import { Test } from '@nestjs/testing';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../src/common/api.exception';
import { InMemoryPetRepository, PET_REPOSITORY } from '../src/pets/pet.repository';
import { PetsService } from '../src/pets/pets.service';
import type { StorageLane } from '../src/uploads/image-storage';
import { UploadsService } from '../src/uploads/uploads.service';

/** 只替身 `laneOfUrl`：照片的审核状态由文件所在的那一档决定（同发动态的图片）。 */
function fakeUploads(lanes: Record<string, StorageLane> = {}): Partial<UploadsService> {
  return { laneOfUrl: async (url: string) => lanes[url] ?? null };
}

describe('PetsService', () => {
  let service: PetsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PET_REPOSITORY, useClass: InMemoryPetRepository },
        { provide: UploadsService, useValue: fakeUploads() },
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

/**
 * 宠物照片接入机审（spec §4.5）。机审发生在上传那一步（`UploadsService.save`），
 * 结论落成文件所在的档：public = 过审，private = 待审。加照片时按档定状态，
 * 与发动态的图片同一条口径；外链 / 拼错的 key 验不了，一律待审（fail-closed）。
 */
describe('PetsService 照片审核', () => {
  let service: PetsService;
  const OWNER = 'u-1';
  const PUBLIC_URL = '/uploads/u-1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg';
  const PRIVATE_URL = '/uploads/u-1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg';
  const EXTERNAL_URL = 'https://picsum.photos/seed/paws-ext/600/800';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PET_REPOSITORY, useClass: InMemoryPetRepository },
        {
          provide: UploadsService,
          useValue: fakeUploads({ [PUBLIC_URL]: 'public', [PRIVATE_URL]: 'private' }),
        },
        PetsService,
      ],
    }).compile();
    service = moduleRef.get(PetsService);
  });

  const add = (url: string) => service.addPhoto('p-1', OWNER, { url, width: 600, height: 800 });

  it('公开档 → approved；私有档 → pending；外链验不了 → pending', async () => {
    expect((await add(PUBLIC_URL)).auditStatus).toBe('approved');
    expect((await add(PRIVATE_URL)).auditStatus).toBe('pending');
    expect((await add(EXTERNAL_URL)).auditStatus).toBe('pending');
  });

  it('请求体里塞 auditStatus 没用 —— 状态只由服务端按档计算', async () => {
    const row = await service.addPhoto('p-1', OWNER, {
      url: EXTERNAL_URL,
      width: 600,
      height: 800,
      auditStatus: 'approved',
    });
    expect(row.auditStatus).toBe('pending');
  });

  it('详情：待审照片别人与未登录看不见，主人看得见且带状态', async () => {
    await add(PRIVATE_URL);
    const urlsOf = (d: Awaited<ReturnType<PetsService['detail']>>) => d?.photos.map((p) => p.url);

    expect(urlsOf(await service.detail('p-1', { viewerId: 'u-2' }))).not.toContain(PRIVATE_URL);
    expect(urlsOf(await service.detail('p-1', { viewerId: null }))).not.toContain(PRIVATE_URL);
    expect(urlsOf(await service.detail('p-1'))).not.toContain(PRIVATE_URL);

    const mine = await service.detail('p-1', { viewerId: OWNER });
    expect(mine?.photos.find((p) => p.url === PRIVATE_URL)?.auditStatus).toBe('pending');
  });

  it('主人改资料后回读的详情同样带着自己的待审照片（编辑页靠它画「审核中」）', async () => {
    await add(PRIVATE_URL);
    const updated = await service.update('p-1', OWNER, { bio: '换个简介' });
    expect(updated.photos.map((p) => p.url)).toContain(PRIVATE_URL);
    expect(updated.isOwn).toBe(true);
  });
});
