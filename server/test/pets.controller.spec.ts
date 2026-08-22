import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { PetsModule } from '../src/pets/pets.module';

describe('PetsController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const moduleRef = await Test.createTestingModule({ imports: [PetsModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /pets → 8 只、page=1、首项距离最近', async () => {
    const res = await request(app.getHttpServer()).get('/pets').expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.items.length).toBe(8);
    expect(res.body.data.page).toBe(1);
    const ds = res.body.data.items.map((i: { distanceMeters: number }) => i.distanceMeters);
    expect([...ds].sort((a: number, b: number) => a - b)).toEqual(ds);
  });

  it('GET /pets?species=cat → 只回猫', async () => {
    const res = await request(app.getHttpServer()).get('/pets?species=cat').expect(200);
    expect(res.body.data.items.every((i: { species: string }) => i.species === 'cat')).toBe(true);
  });

  it('GET /pets?page=2&pageSize=3 → 3 项且 hasMore', async () => {
    const res = await request(app.getHttpServer())
      .get('/pets?page=2&pageSize=3')
      .expect(200);
    expect(res.body.data.items.length).toBe(3);
    expect(res.body.data.hasMore).toBe(true);
  });

  it('GET /pets?lat=39.9&lng=116.4 → 带坐标，首项距离非 null', async () => {
    const res = await request(app.getHttpServer())
      .get('/pets?lat=39.9&lng=116.4')
      .expect(200);
    expect(res.body.data.items[0].distanceMeters).not.toBeNull();
  });

  it('GET /pets?species=alien → 422 + VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer()).get('/pets?species=alien').expect(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('GET /pets?page=0 → 422', async () => {
    const res = await request(app.getHttpServer()).get('/pets?page=0').expect(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('GET /pets?lat=39.9（缺 lng）→ 422', async () => {
    const res = await request(app.getHttpServer()).get('/pets?lat=39.9').expect(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('GET /pets/p-1 → 详情完整', async () => {
    const res = await request(app.getHttpServer()).get('/pets/p-1').expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.name).toBe('大黄');
    expect(res.body.data.photos.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.owner.nickname).toBe('小陈');
  });

  it('GET /pets/nope → 404 + NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/pets/nope').expect(404);
    expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
  });
});
