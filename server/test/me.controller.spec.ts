import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { MeModule } from '../src/me/me.module';
import { PetsModule } from '../src/pets/pets.module';

describe('MeController', () => {
  let app: INestApplication;
  let token: string;

  /** 专属用户隔离（同 pets.controller.spec.ts），且不能是任何种子宠物的主人。 */
  const USER_ID = 'u-test-me-ctl';
  const DB_URL = process.env.DATABASE_URL;
  let pool: Pool | null = null;

  /** 关注端点在 PetsController 上，所以两个模块一起装。 */
  const followUrl = (petId: string) => `/pets/${petId}/follow`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    token = sign({ openid: `openid-${USER_ID}` }, 'test-secret', { subject: USER_ID });
    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      await pool.query(
        `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [USER_ID, `openid-${USER_ID}`, '个人中心测试用户'],
      );
      await pool.query(`DELETE FROM follows WHERE follower_id = $1`, [USER_ID]);
    }
    const moduleRef = await Test.createTestingModule({
      imports: [MeModule, PetsModule],
    }).compile();
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

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  afterEach(async () => {
    for (const petId of ['p-2', 'p-3', 'p-4', 'p-5']) {
      await auth(request(app.getHttpServer()).delete(followUrl(petId)));
    }
  });

  describe('GET /me/following', () => {
    it('未登录 → 401', async () => {
      const res = await request(app.getHttpServer()).get('/me/following').expect(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('没关注过 → 空数组，不是 404', async () => {
      const res = await auth(request(app.getHttpServer()).get('/me/following')).expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toEqual({ items: [], hasMore: false, page: 1 });
    });

    it('返回宠物卡数组，按关注时间倒序', async () => {
      await auth(request(app.getHttpServer()).post(followUrl('p-2')));
      await auth(request(app.getHttpServer()).post(followUrl('p-3')));
      const res = await auth(request(app.getHttpServer()).get('/me/following')).expect(200);
      const items = res.body.data.items as { id: string; name: string; isFollowing: boolean }[];
      expect(items.map((i) => i.id)).toEqual(['p-3', 'p-2']);
      expect(items[0].name).toBe('可乐');
      expect(items.every((i) => i.isFollowing)).toBe(true);
    });

    it('条目是完整宠物卡：封面宽高齐全（瀑布流要用）', async () => {
      await auth(request(app.getHttpServer()).post(followUrl('p-2')));
      const res = await auth(request(app.getHttpServer()).get('/me/following')).expect(200);
      const item = res.body.data.items[0];
      expect(item.coverUrl).toBeTruthy();
      expect(item.coverWidth).toBeGreaterThan(0);
      expect(item.coverHeight).toBeGreaterThan(0);
      expect(item.followedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(item.ownerNickname).toBeTruthy();
    });

    it('无坐标 → distanceMeters 全 null（城市模式）', async () => {
      await auth(request(app.getHttpServer()).post(followUrl('p-2')));
      const res = await auth(request(app.getHttpServer()).get('/me/following')).expect(200);
      expect(
        res.body.data.items.every((i: { distanceMeters: null }) => i.distanceMeters === null),
      ).toBe(true);
    });

    it('带坐标 → distanceMeters 非 null', async () => {
      await auth(request(app.getHttpServer()).post(followUrl('p-2')));
      const res = await auth(
        request(app.getHttpServer()).get('/me/following?lat=39.9042&lng=116.4074'),
      ).expect(200);
      expect(res.body.data.items[0].distanceMeters).not.toBeNull();
    });

    it('分页生效：pageSize=2 → hasMore，page 透传', async () => {
      for (const petId of ['p-2', 'p-3', 'p-4']) {
        await auth(request(app.getHttpServer()).post(followUrl(petId)));
      }
      const first = await auth(
        request(app.getHttpServer()).get('/me/following?page=1&pageSize=2'),
      ).expect(200);
      expect(first.body.data.items).toHaveLength(2);
      expect(first.body.data.hasMore).toBe(true);

      const second = await auth(
        request(app.getHttpServer()).get('/me/following?page=2&pageSize=2'),
      ).expect(200);
      expect(second.body.data.items).toHaveLength(1);
      expect(second.body.data.hasMore).toBe(false);
      expect(second.body.data.page).toBe(2);
    });

    it('page=0 → 422', async () => {
      const res = await auth(request(app.getHttpServer()).get('/me/following?page=0')).expect(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('pageSize=100 → 422（上限 20，防一次拉全表）', async () => {
      const res = await auth(
        request(app.getHttpServer()).get('/me/following?pageSize=100'),
      ).expect(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('只给 lat 不给 lng → 422', async () => {
      const res = await auth(
        request(app.getHttpServer()).get('/me/following?lat=39.9'),
      ).expect(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('不串号：别人的关注不出现在我的列表里', async () => {
      const otherToken = sign({ openid: 'openid-huang' }, 'test-secret', { subject: 'u-1' });
      // u-1 关注 p-2（p-2 属 u-2，合法）
      await request(app.getHttpServer())
        .post(followUrl('p-2'))
        .set('Authorization', `Bearer ${otherToken}`);
      const mine = await auth(request(app.getHttpServer()).get('/me/following')).expect(200);
      expect(mine.body.data.items).toEqual([]);
      // 清理 u-1 的痕迹
      await request(app.getHttpServer())
        .delete(followUrl('p-2'))
        .set('Authorization', `Bearer ${otherToken}`);
    });
  });
});
