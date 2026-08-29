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
  // 有库时每个用例是真往返远程 Postgres，关注那几条一条要三四次（读详情 → 关注 → 再读，
  // 外加 afterEach 的取消关注）。Jest 默认的 5000ms 兜不住，超时会随机落在不同用例上 ——
  // 同 pet-write.controller.spec.ts 与 rate-limit-degradation.integration.spec.ts 的 30_000。
  jest.setTimeout(30_000);

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

  /**
   * 断言的是端点契约，不是「库里正好 8 只」：`POST /pets` 上线后真库的 pets 表会长
   * —— 用户建的、走查脚本建的都在里面，默认 pageSize 是 10，这条曾因此收到 10 只而红。
   * 不给坐标时距离一律为 null（排序退回 `last_active_at`），所以这里也不该断言
   * 「首项距离最近」：全是 null 的数组永远「有序」，那是句空话。带坐标的排序由下面
   * 那条与 pets-postgres.integration 覆盖。
   */
  it('GET /pets 不给坐标 → page=1、不超过一页、距离一律 null', async () => {
    const res = await request(app.getHttpServer()).get('/pets').expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(8); // 种子那 8 只至少撑得起一页
    expect(res.body.data.items.length).toBeLessThanOrEqual(10); // 默认 pageSize
    const ds = res.body.data.items.map(
      (i: { distanceMeters: number | null }) => i.distanceMeters,
    );
    expect(ds.every((d: number | null) => d == null)).toBe(true);
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

  /**
   * 带坐标才有距离，排序契约也只在这条上成立：有位置的按距离升序在前，
   * 没位置的排最后（Postgres `ORDER BY ... ASC` 的 NULLS LAST，InMemory 用
   * `?? +Infinity` 对齐）。用户建宠物时可以不带坐标（偏差 #38：填资料的路上不弹
   * 定位授权框），真库里因此一定有 `location IS NULL` 的行 —— 它们不该插到中间。
   */
  it('GET /pets?lat=39.9&lng=116.4 → 有距离的升序在前，没位置的排最后', async () => {
    const res = await request(app.getHttpServer())
      .get('/pets?lat=39.9&lng=116.4')
      .expect(200);
    expect(res.body.data.items[0].distanceMeters).not.toBeNull();
    const ds: (number | null)[] = res.body.data.items.map(
      (i: { distanceMeters: number | null }) => i.distanceMeters,
    );
    const firstNull = ds.findIndex((d) => d == null);
    const withDistance = (firstNull === -1 ? ds : ds.slice(0, firstNull)) as number[];
    expect(ds.slice(withDistance.length).every((d) => d == null)).toBe(true);
    expect([...withDistance].sort((a, b) => a - b)).toEqual(withDistance);
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

    /**
     * `isOwn`（阶段 3 Task 11）—— 客户端靠它决定关注按钮出不出现。
     *
     * 与上面那条 `FOLLOW_SELF:42203` 是同一件事的两端：服务端仍然会挡下关注自己，
     * 而 `isOwn` 让客户端**压根不摆出**那个必然失败的按钮。
     */
    it('GET /pets/:id 的 isOwn：主人自己看是 true', async () => {
      // u-1 是 p-1 的主人（见种子）。
      const ownerToken = sign({ openid: 'openid-huang' }, 'test-secret', { subject: 'u-1' });
      const mine = await request(app.getHttpServer())
        .get('/pets/p-1')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(mine.body.data.isOwn).toBe(true);
      // 主人看自己的宠物：能收藏（个人书签），但关注不成立 —— 两个状态各自独立。
      expect(mine.body.data.isFollowing).toBe(false);
    });

    it('GET /pets/:id 的 isOwn：别人与未登录都是 false', async () => {
      const other = await request(app.getHttpServer())
        .get('/pets/p-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(other.body.data.isOwn).toBe(false);

      const anon = await request(app.getHttpServer()).get('/pets/p-1').expect(200);
      expect(anon.body.data.isOwn).toBe(false);
    });

    it('GET /pets/:id 不下发 ownerId —— 主人的用户 id 不进公开响应', async () => {
      const res = await request(app.getHttpServer()).get('/pets/p-1').expect(200);
      expect(res.body.data).not.toHaveProperty('ownerId');
      expect(Object.keys(res.body.data.owner).sort()).toEqual([
        'avatarUrl',
        'nickname',
        'ownerVerified',
      ]);
    });
  });
});
