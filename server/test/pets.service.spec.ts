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

  it('list 无坐标 → 距离全 null', async () => {
    const res = await service.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: 10,
    });
    expect(res.items.every((i) => i.distanceMeters === null)).toBe(true);
  });
});
