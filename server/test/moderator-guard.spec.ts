import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AuthGuard } from '../src/auth/auth.guard';
import { ModeratorGuard } from '../src/auth/moderator.guard';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { USER_ROLE_SEED } from '../src/users/user.repository';
import { UsersModule } from '../src/users/users.module';

/**
 * `ModeratorGuard` —— 运营端点的第二道守卫（阶段 3 Task 5）。
 *
 * 挂一个只为本套件存在的探针控制器，而不是拿 Task 6 的真端点来测：守卫的行为
 * 与「那个端点做什么」无关，用真端点会把两件事的失败混在一起。
 *
 * 有库跑真库（角色真的从 `users.role` 读），无库跑内存实现的角色种子，
 * **同一套断言**。两种模式的差别只在夹具怎么把角色摆进去。
 */

const DB_URL = process.env.DATABASE_URL;

/** 三个身份。前缀 `u-mg-` 不与 `^u-[0-9]+$` 的种子计数断言相撞。 */
const PLAIN = 'u-mg-user';
const MODERATOR = 'u-mg-mod';
const ADMIN = 'u-mg-admin';
/** 库里/种子里压根不存在的人。取不到角色也必须是 403，不是 500。 */
const GHOST = 'u-mg-ghost';

@Controller('probe')
class ProbeController {
  /** 守卫数组是**顺序执行**的：AuthGuard 先跑并挂好 req.userId，前一个抛出后一个不跑。 */
  @Get('moderator')
  @UseGuards(AuthGuard, ModeratorGuard)
  moderatorOnly(): { ok: true } {
    return { ok: true };
  }
}

describe('ModeratorGuard（运营角色只从库里读 · Global Constraint 28）', () => {
  let app: INestApplication;
  let pool: Pool | null = null;

  const http = () => request(app.getHttpServer());

  /**
   * 签一张令牌。`claims` 用来伪造额外声明 —— 那条「令牌里写着 admin」的用例
   * 靠它造出来。守卫必须无视这些声明。
   */
  const tokenFor = (sub: string, claims: Record<string, unknown> = {}) =>
    sign({ openid: `openid-${sub}`, ...claims }, 'test-secret', { subject: sub });

  const probe = async (sub?: string, claims?: Record<string, unknown>) => {
    const req = http().get('/probe/moderator');
    return sub ? req.set('Authorization', `Bearer ${tokenFor(sub, claims)}`) : req;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';

    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      // ON CONFLICT ... DO UPDATE 而不是 DO NOTHING：上一轮崩在中途留下的行
      // 角色可能是错的，重跑必须把角色摆回本套件要的值。
      for (const [id, role, nickname] of [
        [PLAIN, 'user', '普通用户'],
        [MODERATOR, 'moderator', '运营'],
        [ADMIN, 'admin', '管理员'],
      ]) {
        await pool.query(
          `INSERT INTO users (id, openid, nickname, role) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
          [id, `openid-${id}`, nickname, role],
        );
      }
    }

    // 只 import `UsersModule`（角色的来源），两个守卫直接当 provider 给。
    // **不 import `AuthModule`**：它带着 `RateLimitModule` → Redis 客户端，
    // 而本套件与限流无关；那条依赖会让无 Redis 的环境卡在重连上（实测跑不完）。
    // 同 `auth-guard.spec.ts` 的做法。
    const builder = Test.createTestingModule({
      imports: [UsersModule],
      controllers: [ProbeController],
      providers: [AuthGuard, ModeratorGuard],
    });
    // 无库模式：角色从可注入的种子里读。有库模式不覆盖 —— 那样才是真的在读 users.role。
    if (!DB_URL) {
      builder.overrideProvider(USER_ROLE_SEED).useValue({
        [PLAIN]: 'user',
        [MODERATOR]: 'moderator',
        [ADMIN]: 'admin',
      });
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
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[PLAIN, MODERATOR, ADMIN]]);
      await pool.end();
    }
  });

  it('未登录 → 401（AuthGuard 先抛，ModeratorGuard 压根不跑）', async () => {
    const res = await probe();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('令牌无效 → 401', async () => {
    // 非 ASCII 放不进 HTTP 头（superagent 会直接抛），所以这里用一串合法字符的乱值。
    const res = await http().get('/probe/moderator').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  it('普通用户 → 403，不是 401（他登录了，只是权限不够）', async () => {
    const res = await probe(PLAIN);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('moderator → 放行', async () => {
    const res = await probe(MODERATOR);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ok: true });
  });

  it('admin → 放行（admin 是 moderator 的超集）', async () => {
    const res = await probe(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ok: true });
  });

  it('令牌里声明了 role: admin 但库里是 user → 403（角色只从库里读）', async () => {
    // 令牌是阶段 0 签的，里面没有角色字段。守卫若信了令牌，
    // 任何人自签一张带 role 的令牌就能进运营后台。
    const res = await probe(PLAIN, { role: 'admin' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('令牌里声明 role: moderator 也不算 → 403', async () => {
    const res = await probe(PLAIN, { role: 'moderator' });
    expect(res.status).toBe(403);
  });

  it('库里查不到这个人 → 403，不是 500', async () => {
    const res = await probe(GHOST);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN);
  });
});
