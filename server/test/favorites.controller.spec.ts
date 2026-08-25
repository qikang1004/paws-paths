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
import { VenuesModule } from '../src/venues/venues.module';

/**
 * 收藏的端到端：宠物心标（原型 _2）、场所收藏（原型 _3）、以及把两者混排的
 * GET /me/favorites。三个模块一起装 —— 收藏是跨域的，只装一个测不出混排。
 *
 * 有库时跑真库、无库时跑内存实现，两边同一套断言（与 me.controller.spec 同款）。
 */
describe('收藏（宠物 + 场所 + 我的收藏）', () => {
  let app: INestApplication;
  let token: string;

  /** 专属用户，且不能是任何种子宠物的主人。 */
  const USER_ID = 'u-test-fav-ctl';
  const DB_URL = process.env.DATABASE_URL;
  let pool: Pool | null = null;

  const petFav = (petId: string) => `/pets/${petId}/favorite`;
  const venueFav = (poiId: string) => `/venues/${poiId}/favorite`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    token = sign({ openid: `openid-${USER_ID}` }, 'test-secret', { subject: USER_ID });
    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      await pool.query(
        `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [USER_ID, `openid-${USER_ID}`, '收藏端点测试用户'],
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [MeModule, PetsModule, VenuesModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (pool) {
      await pool.query(`DELETE FROM favorites WHERE user_id = $1`, [USER_ID]);
      await pool.query(`DELETE FROM view_history WHERE user_id = $1`, [USER_ID]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [USER_ID]);
      await pool.end();
    }
  });

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  const server = () => app.getHttpServer();

  /** 每个用例自己收自己的，跑完清干净 —— 无库模式下内存实例是全套件共享的。 */
  afterEach(async () => {
    for (const petId of ['p-1', 'p-2', 'p-3']) {
      await auth(request(server()).delete(petFav(petId)));
    }
    for (const poiId of ['v-1', 'v-2', 'poi-本库没有这家']) {
      await auth(request(server()).delete(venueFav(poiId)));
    }
  });

  const listFavorites = async (query = ''): Promise<request.Response> =>
    auth(request(server()).get(`/me/favorites${query}`));

  describe('POST/DELETE /pets/:id/favorite', () => {
    it('收藏后 200 且 isFavorite true，详情页心标同步亮起', async () => {
      const res = await auth(request(server()).post(petFav('p-1'))).expect(200);
      expect(res.body).toEqual({ code: 0, message: 'ok', data: { isFavorite: true } });

      const detail = await auth(request(server()).get('/pets/p-1')).expect(200);
      expect(detail.body.data.isFavorite).toBe(true);
      // 收藏与关注是两个独立状态：只收藏不该让 isFollowing 也变 true。
      expect(detail.body.data.isFollowing).toBe(false);
    });

    it('重复收藏幂等：还是 200，列表里也只有一条', async () => {
      await auth(request(server()).post(petFav('p-1'))).expect(200);
      await auth(request(server()).post(petFav('p-1'))).expect(200);
      const res = await listFavorites();
      expect(res.body.data.items).toHaveLength(1);
    });

    it('取消收藏后详情页心标灭掉，取消没收藏过的也不报错', async () => {
      await auth(request(server()).post(petFav('p-1'))).expect(200);
      await auth(request(server()).delete(petFav('p-1'))).expect(200);
      const detail = await auth(request(server()).get('/pets/p-1')).expect(200);
      expect(detail.body.data.isFavorite).toBe(false);
      await auth(request(server()).delete(petFav('p-1'))).expect(200);
    });

    it('收藏不存在的宠物 404 —— target_id 没有外键，脏 id 必须在这一层挡住', async () => {
      const res = await auth(request(server()).post(petFav('p-不存在'))).expect(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('未登录不能收藏，也不能看别人的收藏夹', async () => {
      await request(server()).post(petFav('p-1')).expect(401);
      await request(server()).delete(petFav('p-1')).expect(401);
      await request(server()).get('/me/favorites').expect(401);
    });

    it('未登录看详情页时心标是灭的，而不是缺字段', async () => {
      const detail = await request(server()).get('/pets/p-1').expect(200);
      expect(detail.body.data.isFavorite).toBe(false);
    });
  });

  describe('GET /me/favorites', () => {
    it('宠物与场所混排，按收藏时间倒序', async () => {
      await auth(request(server()).post(petFav('p-1'))).expect(200);
      await auth(request(server()).post(venueFav('v-1'))).expect(200);

      const res = await listFavorites();
      const items = res.body.data.items as Array<{
        targetType: string;
        targetId: string;
        title: string;
        favoritedAt: string;
      }>;
      expect(items.map((i) => `${i.targetType}:${i.targetId}`)).toEqual(['venue:v-1', 'pet:p-1']);
      // 投影出来的标题不是 id，说明两类目标都真的查了一遍
      expect(items[0].title).not.toBe('v-1');
      expect(items[1].title).not.toBe('p-1');
      expect(new Date(items[0].favoritedAt).toISOString()).toBe(items[0].favoritedAt);
    });

    it('空收藏夹返回空数组，不是 404', async () => {
      const res = await listFavorites();
      expect(res.body.data).toEqual({ items: [], hasMore: false, page: 1 });
    });

    it('投影不到的目标被丢掉 —— 场所来自腾讯 POI，本库可能没有这一行', async () => {
      // 这条会真的落库（target_id 无外键），但列表里不该出现半空的坏卡片。
      await auth(request(server()).post(venueFav('poi-本库没有这家'))).expect(200);
      await auth(request(server()).post(petFav('p-1'))).expect(200);
      const res = await listFavorites();
      expect(res.body.data.items.map((i: { targetId: string }) => i.targetId)).toEqual(['p-1']);
    });

    it('分页参数沿用统一校验：pageSize 越界 422', async () => {
      const res = await listFavorites('?pageSize=0');
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('分页：pageSize=1 时第一页 hasMore 为 true，第二页拿到另一条', async () => {
      await auth(request(server()).post(petFav('p-1'))).expect(200);
      await auth(request(server()).post(petFav('p-2'))).expect(200);

      const first = await listFavorites('?pageSize=1');
      expect(first.body.data.items).toHaveLength(1);
      expect(first.body.data.hasMore).toBe(true);
      const second = await listFavorites('?page=2&pageSize=1');
      expect(second.body.data.hasMore).toBe(false);
      expect(second.body.data.items[0].targetId).not.toBe(first.body.data.items[0].targetId);
    });
  });

  describe('阶段 1 的场所收藏不受迁移影响', () => {
    it('场所收藏 → 详情页与列表都标 isFavorite', async () => {
      await auth(request(server()).post(venueFav('v-1'))).expect(200);
      const detail = await auth(request(server()).get('/venues/v-1')).expect(200);
      expect(detail.body.data.isFavorite).toBe(true);
      await auth(request(server()).delete(venueFav('v-1'))).expect(200);
      const after = await auth(request(server()).get('/venues/v-1')).expect(200);
      expect(after.body.data.isFavorite).toBe(false);
    });

    it('同名的 pet 与 venue 互不干扰 —— 主键带 target_type', async () => {
      // 种子里 p-1 与 v-1 是两个不同的 id，这里用「收了宠物不该让场所亮」来验类型隔离。
      await auth(request(server()).post(petFav('p-1'))).expect(200);
      const venue = await auth(request(server()).get('/venues/v-1')).expect(200);
      expect(venue.body.data.isFavorite).toBe(false);
    });
  });
});
