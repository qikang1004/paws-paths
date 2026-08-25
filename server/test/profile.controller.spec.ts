import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { MeModule } from '../src/me/me.module';
import { UsersService } from '../src/users/users.service';

/**
 * 个人中心资料：GET /me 的聚合计数与 PATCH /me 的改名改头像。
 *
 * 测试用户经 UsersService.upsertByOpenid 建号（而不是直插 users 表），两个原因：
 * 无库模式下内存仓储里也得真有这个人，否则 404；有库模式下这条路径落的昵称
 * 正是阶段 1 的占位值「微信用户」—— 计划的验收项要的就是「占位昵称能改掉」。
 * 建号发的是随机 id，所以 token 必须等建完号才能签。
 */
describe('个人中心资料（GET /me + PATCH /me）', () => {
  let app: INestApplication;
  let token: string;
  let userId: string;

  const OPENID = 'openid-u-test-profile';
  const DB_URL = process.env.DATABASE_URL;
  let pool: Pool | null = null;

  const me = () => request(app.getHttpServer()).get('/me');
  const patchMe = () => request(app.getHttpServer()).patch('/me');
  const putMe = () => request(app.getHttpServer()).put('/me');
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  /** 有库时按 openid 连带清掉这个人的关系数据（favorites 没有 ON DELETE CASCADE）。 */
  const purge = async (): Promise<void> => {
    if (!pool) return;
    await pool.query(
      `DELETE FROM favorites WHERE user_id IN (SELECT id FROM users WHERE openid = $1)`,
      [OPENID],
    );
    await pool.query(`DELETE FROM pets WHERE owner_id IN (SELECT id FROM users WHERE openid = $1)`, [
      OPENID,
    ]);
    await pool.query(`DELETE FROM users WHERE openid = $1`, [OPENID]);
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      // 上一轮残留的话昵称已经被改过，「占位昵称能改掉」就测不到了。
      await purge();
    }
    const moduleRef = await Test.createTestingModule({ imports: [MeModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const { user } = await app.get(UsersService).upsertByOpenid(OPENID);
    userId = user.id;
    token = sign({ openid: OPENID }, 'test-secret', { subject: userId });
  });

  afterAll(async () => {
    await app.close();
    if (pool) {
      await purge();
      await pool.end();
    }
  });

  /** 每条改过资料的用例都把昵称与头像复位，后面的用例才能从占位状态出发。 */
  const reset = async (): Promise<void> => {
    await auth(patchMe().send({ nickname: '微信用户', avatarUrl: null }));
  };

  describe('GET /me', () => {
    it('未登录 401', async () => {
      await me().expect(401);
    });

    it('新号：占位昵称、无头像、未认证、三个计数都是 0', async () => {
      const res = await auth(me()).expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toEqual({
        nickname: '微信用户',
        avatarUrl: null,
        isVerifiedOwner: false,
        petCount: 0,
        followingCount: 0,
        favoriteCount: 0,
      });
    });

    it('token 指向不存在的用户 → 404 而不是空资料', async () => {
      const ghost = sign({ openid: 'openid-ghost' }, 'test-secret', { subject: 'u-不存在' });
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${ghost}`)
        .expect(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });
  });

  describe('PATCH /me', () => {
    afterEach(reset);

    it('未登录 401', async () => {
      await patchMe().send({ nickname: '谁' }).expect(401);
    });

    it('占位昵称「微信用户」能改掉，且真的存下来了', async () => {
      const res = await auth(patchMe().send({ nickname: '养猫的小陈' })).expect(200);
      expect(res.body.data.nickname).toBe('养猫的小陈');
      // 回读一次：PATCH 的返回值可能只是回显入参，落库才是真的
      const after = await auth(me()).expect(200);
      expect(after.body.data.nickname).toBe('养猫的小陈');
      // 改名不该顺手动到别的字段
      expect(after.body.data.avatarUrl).toBeNull();
      expect(after.body.data.petCount).toBe(0);
    });

    it('只传头像时昵称不动，传 null 能把头像清掉', async () => {
      await auth(patchMe().send({ nickname: '先改个名' })).expect(200);
      const set = await auth(
        patchMe().send({ avatarUrl: 'https://picsum.photos/seed/paw-me/120/120' }),
      ).expect(200);
      expect(set.body.data.avatarUrl).toBe('https://picsum.photos/seed/paw-me/120/120');
      expect(set.body.data.nickname).toBe('先改个名');

      const cleared = await auth(patchMe().send({ avatarUrl: null })).expect(200);
      expect(cleared.body.data.avatarUrl).toBeNull();
      expect(cleared.body.data.nickname).toBe('先改个名');
    });

    it('昵称首尾空格被裁掉再存', async () => {
      const res = await auth(patchMe().send({ nickname: '  阿喵  ' })).expect(200);
      expect(res.body.data.nickname).toBe('阿喵');
    });

    it('昵称空串、纯空格、超 20 字都是 422', async () => {
      for (const nickname of ['', '   ', 'x'.repeat(21)]) {
        const res = await auth(patchMe().send({ nickname }));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
      // 正好 20 字是允许的边界
      await auth(patchMe().send({ nickname: 'x'.repeat(20) })).expect(200);
    });

    it('20 个 emoji 的昵称按码点算长度，不该被当成 40 字拦下', async () => {
      const res = await auth(patchMe().send({ nickname: '🐶'.repeat(20) })).expect(200);
      expect(res.body.data.nickname).toBe('🐶'.repeat(20));
    });

    it('昵称不是字符串 → 422', async () => {
      const res = await auth(patchMe().send({ nickname: 123 }));
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('空 body 或只含无关字段 → 422（没有可改的字段就是客户端 bug）', async () => {
      for (const body of [{}, { isVerifiedOwner: true }, { petCount: 99 }]) {
        const res = await auth(patchMe().send(body));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });

    it('头像只收 http(s) 或站内路径，data:/javascript: 一律 422', async () => {
      for (const avatarUrl of [
        'data:image/png;base64,AAAA',
        'javascript:alert(1)',
        'ftp://x/y.png',
        '',
        123,
      ]) {
        const res = await auth(patchMe().send({ avatarUrl }));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
      // 上传通道（Task 11）落的是站内路径，必须收
      await auth(patchMe().send({ avatarUrl: '/uploads/avatar/abc.jpg' })).expect(200);
    });
  });

  /**
   * `wx.request` 的 method 白名单里没有 PATCH，小程序端只能发 PUT，
   * 所以 /me 上两个动词共用一份实现。这一段盯的就是「两个动词不许分叉」。
   */
  describe('PUT /me（小程序端只能发 PUT）', () => {
    afterEach(reset);

    it('未登录同样 401', async () => {
      await putMe().send({ nickname: '谁' }).expect(401);
    });

    it('与 PATCH 同语义：改名落库，没动的字段不动', async () => {
      const res = await auth(putMe().send({ nickname: '走 PUT 改名' })).expect(200);
      expect(res.body.data.nickname).toBe('走 PUT 改名');
      const after = await auth(me()).expect(200);
      expect(after.body.data.nickname).toBe('走 PUT 改名');
      expect(after.body.data.avatarUrl).toBeNull();
    });

    it('avatarUrl: null 走 PUT 也能清空头像', async () => {
      await auth(putMe().send({ avatarUrl: '/uploads/avatar/abc.jpg' })).expect(200);
      const cleared = await auth(putMe().send({ avatarUrl: null })).expect(200);
      expect(cleared.body.data.avatarUrl).toBeNull();
    });

    it('校验也是同一份：空 body 与非法头像照样 422', async () => {
      for (const body of [{}, { avatarUrl: 'javascript:alert(1)' }, { nickname: '   ' }]) {
        const res = await auth(putMe().send(body));
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });
  });

  const describeDb = DB_URL ? describe : describe.skip;
  describeDb('计数是真查出来的', () => {
    /**
     * 无库模式下内存用户仓储看不见 pets/follows/favorites，计数恒为 0（有意的降级，
     * 见 phase2-notes.md），所以这一段只在真库下跑。
     */
    beforeAll(async () => {
      await pool!.query(
        `INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date)
         VALUES ('p-test-profile', $1, '测试宠物', 'cat', '布偶', 'female', '2024-01-01')
         ON CONFLICT (id) DO NOTHING`,
        [userId],
      );
      await pool!.query(
        `INSERT INTO follows (id, follower_id, target_pet_id) VALUES ('f-test-profile', $1, 'p-2')
         ON CONFLICT DO NOTHING`,
        [userId],
      );
      await pool!.query(
        `INSERT INTO favorites (user_id, target_type, target_id) VALUES ($1,'pet','p-3'), ($1,'venue','v-1')
         ON CONFLICT DO NOTHING`,
        [userId],
      );
    });

    afterAll(async () => {
      await pool!.query(`DELETE FROM follows WHERE id = 'f-test-profile'`);
      await pool!.query(`DELETE FROM favorites WHERE user_id = $1`, [userId]);
      await pool!.query(`DELETE FROM pets WHERE id = 'p-test-profile'`);
    });

    it('宠物数 / 关注数 / 收藏数各自算对，一次请求全带回来', async () => {
      const res = await auth(me()).expect(200);
      expect(res.body.data.petCount).toBe(1);
      expect(res.body.data.followingCount).toBe(1);
      expect(res.body.data.favoriteCount).toBe(2);
    });

    it('别人的数据不算进我的计数里', async () => {
      // u-1 在种子里有 1 只宠物、3 条关注；这些都不该出现在我的资料里
      const res = await auth(me()).expect(200);
      expect(res.body.data.followingCount).toBe(1);
    });
  });
});
