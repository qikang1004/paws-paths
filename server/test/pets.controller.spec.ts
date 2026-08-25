import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { PetsModule } from '../src/pets/pets.module';

describe('PetsController', () => {
  let app: INestApplication;
  let token: string;

  /**
   * 设了 DATABASE_URL 时本套件走真库，会写 follows 表。用专属用户隔离，
   * 免得和 follow-repository.spec.ts 抢种子用户 u-1 的行（同 venues.controller.spec.ts）。
   * 注意：专属用户不能是任何种子宠物的主人，否则关注用例会撞 FOLLOW_SELF。
   */
  const USER_ID = 'u-test-pets-ctl';
  const DB_URL = process.env.DATABASE_URL;
  let pool: Pool | null = null;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    token = sign({ openid: `openid-${USER_ID}` }, 'test-secret', { subject: USER_ID });
    if (DB_URL) {
      // 建表与种子由 test/global-setup.ts 全局跑一次。
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      // follows.follower_id 有外键，专属用户得先存在。
      await pool.query(
        `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [USER_ID, `openid-${USER_ID}`, '宠物接口测试用户'],
      );
      await pool.query(`DELETE FROM follows WHERE follower_id = $1`, [USER_ID]);
    }
    const moduleRef = await Test.createTestingModule({ imports: [PetsModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (pool) {
      await pool.query(`DELETE FROM follows WHERE follower_id = $1`, [USER_ID]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [USER_ID]);
      await pool.end();
    }
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

  describe('关注', () => {
    // p-2 属 u-2，不是本套件的专属用户，可以关注
    const TARGET = 'p-2';

    afterEach(async () => {
      await request(app.getHttpServer())
        .delete(`/pets/${TARGET}/follow`)
        .set('Authorization', `Bearer ${token}`);
    });

    it('POST /pets/:id/follow 未登录 → 401', async () => {
      const res = await request(app.getHttpServer()).post(`/pets/${TARGET}/follow`).expect(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('DELETE /pets/:id/follow 未登录 → 401', async () => {
      const res = await request(app.getHttpServer()).delete(`/pets/${TARGET}/follow`).expect(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('POST 关注 → 200（不是 201，幂等状态设置）+ isFollowing: true', async () => {
      const res = await request(app.getHttpServer())
        .post(`/pets/${TARGET}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toEqual({ isFollowing: true });
    });

    it('重复 POST 仍 200 且仍 true（幂等）', async () => {
      const url = `/pets/${TARGET}/follow`;
      await request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const res = await request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toEqual({ isFollowing: true });
    });

    it('DELETE 取消关注 → isFollowing: false', async () => {
      await request(app.getHttpServer())
        .post(`/pets/${TARGET}/follow`)
        .set('Authorization', `Bearer ${token}`);
      const res = await request(app.getHttpServer())
        .delete(`/pets/${TARGET}/follow`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toEqual({ isFollowing: false });
    });

    it('关注不存在的宠物 → 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/pets/p-nope/follow')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('关注自己的宠物 → 422 + FOLLOW_SELF', async () => {
      // u-1 是 p-1 的主人
      const ownerToken = sign({ openid: 'openid-huang' }, 'test-secret', { subject: 'u-1' });
      const res = await request(app.getHttpServer())
        .post('/pets/p-1/follow')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(422);
      expect(res.body.code).toBe(ERROR_CODES.FOLLOW_SELF);
      expect(res.body.message).toBe('不能关注自己的宠物');
    });

    it('GET /pets 未登录 → isFollowing 全 false', async () => {
      const res = await request(app.getHttpServer()).get('/pets').expect(200);
      expect(
        res.body.data.items.every((i: { isFollowing: boolean }) => i.isFollowing === false),
      ).toBe(true);
    });

    it('GET /pets 登录态 → 已关注的那只标 true，其余 false', async () => {
      await request(app.getHttpServer())
        .post(`/pets/${TARGET}/follow`)
        .set('Authorization', `Bearer ${token}`);
      const res = await request(app.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const items = res.body.data.items as { id: string; isFollowing: boolean }[];
      expect(items.find((i) => i.id === TARGET)?.isFollowing).toBe(true);
      expect(items.filter((i) => i.isFollowing)).toHaveLength(1);
    });

    it('GET /pets/:id 登录态 → 详情带 isFollowing', async () => {
      const before = await request(app.getHttpServer())
        .get(`/pets/${TARGET}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(before.body.data.isFollowing).toBe(false);

      await request(app.getHttpServer())
        .post(`/pets/${TARGET}/follow`)
        .set('Authorization', `Bearer ${token}`);
      const after = await request(app.getHttpServer())
        .get(`/pets/${TARGET}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(after.body.data.isFollowing).toBe(true);
    });

    it('GET /pets/:id 未登录 → isFollowing false，不报错', async () => {
      const res = await request(app.getHttpServer()).get(`/pets/${TARGET}`).expect(200);
      expect(res.body.data.isFollowing).toBe(false);
    });
  });
});
