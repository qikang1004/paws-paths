import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { VenuesModule } from '../src/venues/venues.module';

describe('VenuesController', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    token = sign({ openid: 'openid-huang' }, 'test-secret', { subject: 'u-1' });
    const moduleRef = await Test.createTestingModule({ imports: [VenuesModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /venues → 200，10 家，首项距离最近', async () => {
    const res = await request(app.getHttpServer())
      .get('/venues?lat=39.9042&lng=116.4074')
      .expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.length).toBe(10);
    const ds = res.body.data.map((v: { distanceMeters: number }) => v.distanceMeters);
    expect([...ds].sort((a: number, b: number) => a - b)).toEqual(ds);
  });

  it('GET /venues?category=park → 2 家', async () => {
    const res = await request(app.getHttpServer()).get('/venues?category=park').expect(200);
    expect(res.body.data.length).toBe(2);
  });

  it('GET /venues?keyword=医院 → 2 家', async () => {
    const res = await request(app.getHttpServer()).get('/venues?keyword=医院').expect(200);
    expect(res.body.data.length).toBe(2);
  });

  it('GET /venues?category=alien → 422', async () => {
    const res = await request(app.getHttpServer()).get('/venues?category=alien').expect(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('GET /venues/v-1 → 200，name 与 rating 正确', async () => {
    const res = await request(app.getHttpServer()).get('/venues/v-1').expect(200);
    expect(res.body.data.name).toBe('宠福康宠物医院');
    expect(res.body.data.rating).toBe(4.8);
  });

  it('GET /venues/nope → 404', async () => {
    const res = await request(app.getHttpServer()).get('/venues/nope').expect(404);
    expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('带 token 的 POST/DELETE /venues/v-3/favorite → true / false', async () => {
    const added = await request(app.getHttpServer())
      .post('/venues/v-3/favorite')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(added.body.data.isFavorite).toBe(true);

    const removed = await request(app.getHttpServer())
      .delete('/venues/v-3/favorite')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(removed.body.data.isFavorite).toBe(false);
  });

  it('无 token 的 POST /venues/v-3/favorite → 401', async () => {
    const res = await request(app.getHttpServer()).post('/venues/v-3/favorite').expect(401);
    expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('带 token 的 GET /venues → 收藏过的项 isFavorite true', async () => {
    await request(app.getHttpServer())
      .post('/venues/v-5/favorite')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/venues')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const favorite = res.body.data.filter((v: { isFavorite: boolean }) => v.isFavorite);
    expect(favorite.map((v: { poiId: string }) => v.poiId)).toEqual(['v-5']);
  });
});
