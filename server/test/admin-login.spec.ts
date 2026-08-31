import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { verify } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AuthModule } from '../src/auth/auth.module';
import { hashPassword } from '../src/auth/password';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../src/common/rate-limit/rate-limit.store';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import {
  ADMIN_CREDENTIAL_SEED,
  type AdminCredentialSeed,
} from '../src/users/user.repository';

/**
 * 运营后台的账号密码登录（阶段 4）：`POST /auth/admin-login`。
 *
 * 为什么需要它：`POST /auth/wx-login` 要一个微信 `code`，浏览器里拿不到。
 * 运营后台是独立部署的 Web 应用，只能走账号密码。
 *
 * **这条路径与小程序登录最实质的区别是它有可爆破的凭据** —— 微信登录压根没有
 * 密码可猜。所以限流是这一组断言里占比最大的部分，且键控维度有两个：
 *   · 按用户名：防单账号爆破；
 *   · 按 IP：防扫号（攻击者换用户名就绕过按用户名那条）。
 * 两条**都要**，缺一条就留一个绕过口。
 */

const DB_URL = process.env.DATABASE_URL;

/** 运营账号。前缀不与 `^u-[0-9]+$` 的种子计数断言相撞。 */
const ADMIN_ID = 'u-al-admin';
const ADMIN_USERNAME = 'ops-login-test';
const ADMIN_PASSWORD = 'correct horse battery staple';
/** 普通用户：有用户名密码但 role 是 user —— 登录成功，但拿不到运营端点。 */
const PLAIN_ID = 'u-al-plain';
const PLAIN_USERNAME = 'plain-login-test';

/** 计数用的内存 store，同时暴露键名供断言。 */
class CountingStore implements RateLimitStore {
  readonly counts = new Map<string, number>();

  async increment(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  keys(): string[] {
    return [...this.counts.keys()];
  }
}

describe('运营登录 POST /auth/admin-login', () => {
  let app: INestApplication;
  let store: CountingStore;
  let pool: Pool | null = null;

  const login = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/admin-login').send(body);

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const adminHash = await hashPassword(ADMIN_PASSWORD);
    const plainHash = await hashPassword(ADMIN_PASSWORD);

    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      for (const [id, username, hash, role] of [
        [ADMIN_ID, ADMIN_USERNAME, adminHash, 'moderator'],
        [PLAIN_ID, PLAIN_USERNAME, plainHash, 'user'],
      ]) {
        await pool.query(
          `INSERT INTO users (id, openid, nickname, role, username, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE
             SET role = EXCLUDED.role, username = EXCLUDED.username,
                 password_hash = EXCLUDED.password_hash`,
          [id, `openid-${id}`, '运营登录测试', role, username, hash],
        );
      }
    }

    store = new CountingStore();
    const builder = Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue(store);
    if (!DB_URL) {
      // 无库模式：凭据从可注入的种子里读（同 USER_ROLE_SEED 的做法）。
      builder.overrideProvider(ADMIN_CREDENTIAL_SEED).useValue({
        [ADMIN_USERNAME]: { userId: ADMIN_ID, passwordHash: adminHash, role: 'moderator' },
        [PLAIN_USERNAME]: { userId: PLAIN_ID, passwordHash: plainHash, role: 'user' },
      } satisfies AdminCredentialSeed);
    }
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (pool) {
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[ADMIN_ID, PLAIN_ID]]);
      await pool.end();
    }
  });

  beforeEach(() => {
    store.counts.clear();
  });

  describe('登录成功', () => {
    it('用户名密码正确 → 200 + 令牌，令牌的 sub 是那个用户 id', async () => {
      const res = await login({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(ERROR_CODES.OK);
      const payload = verify(res.body.data.token as string, 'test-secret') as {
        sub?: string;
        openid?: string;
        role?: string;
      };
      expect(payload.sub).toBe(ADMIN_ID);
      // **令牌里不带 role**（Global Constraint 28）：角色只从库里读，
      // 否则撤销运营权限要等到令牌过期才生效。
      expect(payload.role).toBeUndefined();
    });

    it('响应带 role，供后台决定显示哪些菜单 —— 但那只是展示用', async () => {
      const res = await login({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
      // 后端每次请求仍会用 ModeratorGuard 从库里查一次；这个字段只是让前端
      // 少画一个它无权访问的入口，不是权限判据。
      expect(res.body.data.role).toBe('moderator');
    });

    it('不下发 password_hash，也不下发 openid', async () => {
      const res = await login({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
      expect(res.body.data).not.toHaveProperty('passwordHash');
      expect(res.body.data).not.toHaveProperty('password_hash');
      expect(res.body.data).not.toHaveProperty('openid');
    });

    it('role 为 user 的账号也能登录 —— 权限在端点上判，不在登录时判', async () => {
      // 登录只证明「你是谁」。能不能进运营端点由 ModeratorGuard 决定。
      // 在登录时就拦掉非运营，会让「降权后还能登录但看不到东西」这种正常状态
      // 变成一个说不清的 401。
      const res = await login({ username: PLAIN_USERNAME, password: ADMIN_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('user');
    });
  });

  describe('登录失败：用户名不存在与密码错误必须无法区分', () => {
    it('两者的响应完全一致（状态码、错误码、文案一字不差）', async () => {
      const wrongPassword = await login({
        username: ADMIN_USERNAME,
        password: '这个密码是错的但够长',
      });
      const noSuchUser = await login({
        username: 'not-a-real-account',
        password: ADMIN_PASSWORD,
      });
      expect(wrongPassword.status).toBe(401);
      expect(noSuchUser.status).toBe(401);
      expect(wrongPassword.body).toEqual(noSuchUser.body);
      expect(wrongPassword.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('没有用户名的账号（小程序用户）也走同一个 401', async () => {
      // 所有小程序用户的 username 都是 NULL。拿他们的昵称或 id 来登录
      // 必须与「用户名不存在」无法区分 —— 否则能问出「这个 id 存在」。
      const res = await login({ username: 'u-1', password: ADMIN_PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('密码为空 / 缺字段 → 422，而不是 401（那是入参问题，不是凭据问题）', async () => {
      for (const body of [{}, { username: ADMIN_USERNAME }, { password: ADMIN_PASSWORD }]) {
        const res = await login(body);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });
  });

  describe('限流：按用户名 + 按 IP，两条都要', () => {
    it('两个键都被计数 —— 缺任何一条都留一个绕过口', async () => {
      await login({ username: ADMIN_USERNAME, password: 'wrong-but-long-enough' });
      const keys = store.keys();
      // 按用户名：防单账号爆破。
      expect(keys).toContain(`admin-login:user:${ADMIN_USERNAME}`);
      // 按 IP：攻击者换用户名就绕过上面那条，所以还要这条防扫号。
      expect(keys.some((key) => key.startsWith('admin-login:ip:'))).toBe(true);
    });

    it('用户名那条键控用的是**请求里的用户名**，不是解析后的用户 id', async () => {
      // 用户名不存在时也必须计数 —— 否则「猜用户名」这一步完全不受限，
      // 攻击者可以先无限枚举用户名，再对存在的那个下手。
      await login({ username: 'enumerate-me', password: 'wrong-but-long-enough' });
      expect(store.keys()).toContain('admin-login:user:enumerate-me');
    });

    it('超过上限 → 429 RATE_LIMITED，而不是 401', async () => {
      // 上限比登录端点低得多：运营账号数量固定，正常人不会一小时试 20 次密码。
      for (let i = 0; i < 10; i += 1) {
        await login({ username: ADMIN_USERNAME, password: 'wrong-but-long-enough' });
      }
      const over = await login({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
      expect(over.status).toBe(429);
      expect(over.body.code).toBe(ERROR_CODES.RATE_LIMITED);
    });

    it('限流在校验之后、验密码之前 —— 非法入参不该消耗配额', async () => {
      await login({});
      expect(store.keys()).toEqual([]);
    });
  });
});
