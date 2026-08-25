import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import {
  CONTENT_SECURITY_API,
  type ContentSecurityApi,
  type ContentSecurityVerdict,
} from '../src/moderation/content-security';
import { POST_REPOSITORY, type PostRepository } from '../src/posts/post.repository';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';

/**
 * Global Constraint 16 的专项安全测试：**未 approved 的内容对他人一律不可见**。
 *
 * 这是小程序过审的必要条件，所以独立成文件，并且**整套门控在真 Postgres 上**：
 * 可见性过滤落在 SQL 的 WHERE 子句里（`audit_status = ANY($2) OR author_id = $3`），
 * 内存实现是另一份代码。只在内存上验等于没验 —— 真正会漏的是 SQL 那一份。
 *
 * 夹具用**自己的用户和宠物**（`u-vis-*` / `p-vis-*`），不碰种子数据：
 * 这套断言要数「一页有几条」，任何别的套件往 p-1 上发一条动态都会把它弄红。
 *
 * 关于计划里「关注流 `GET /me/feed` 同样过滤」那一条：本阶段**没有**关注流端点
 * （`PostsController` 只有列表与详情两个读路径）。空跑一条 404 断言证明不了任何事，
 * 所以改成文件末尾那条静态守卫 —— 将来谁加了 feed 路由，它会红，并把人指回这里。
 */

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('动态可见性（Global Constraint 16 · 真库门控）', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let posts: PostsService;
  let repo: PostRepository;
  let pool: Pool;
  let root: string;

  /** 夹具：作者、另一个登录用户、两只宠物（第二只专供「过审后可见」那条，免得扰动计数）。 */
  const AUTHOR = 'u-vis-author';
  const OTHER = 'u-vis-other';
  const PET = 'p-vis-1';
  const PET_FLIP = 'p-vis-2';

  /** 三条动态的 id，beforeAll 里发出来。 */
  let approvedId: string;
  let pendingId: string;
  let rejectedId: string;

  /** 机审裁决由 publish() 的调用方指定。 */
  let verdict: ContentSecurityVerdict = 'pending';
  const security: ContentSecurityApi = {
    checkText: async () => verdict,
    checkImage: async () => verdict,
  };

  const http = () => request(app.getHttpServer());
  const tokenFor = (sub: string) => sign({ openid: `openid-${sub}` }, 'test-secret', { subject: sub });
  const as = (req: request.Test, sub: string) => req.set('Authorization', `Bearer ${tokenFor(sub)}`);

  /** 发一条动态并等机审收敛。响应恒为 pending —— 机审是后台的事。 */
  const publish = async (petId: string, content: string, v: ContentSecurityVerdict) => {
    verdict = v;
    const res = await as(http().post('/posts'), AUTHOR).send({ petId, content });
    expect(res.status).toBe(201);
    expect(res.body.data.auditStatus).toBe('pending');
    await posts.settleAuditChecks();
    return res.body.data.id as string;
  };

  /** 列表：`sub` 为 undefined 时不带令牌（未登录）。 */
  const listOf = async (petId: string, sub?: string, query = '') => {
    const req = http().get(`/posts?petId=${petId}${query}`);
    const res = await (sub ? as(req, sub) : req);
    expect(res.status).toBe(200);
    return res.body.data as {
      items: { id: string; auditStatus: string; rejectReason: string | null; publishedAt: string }[];
      hasMore: boolean;
      page: number;
    };
  };

  const idsOf = async (petId: string, sub?: string, query = '') =>
    (await listOf(petId, sub, query)).items.map((item) => item.id);

  /** 详情：断言状态码并回响应体。 */
  const detailOf = async (id: string, sub?: string) => {
    const req = http().get(`/posts/${id}`);
    return sub ? as(req, sub) : req;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    root = mkdtempSync(join(tmpdir(), 'paws-visibility-'));
    process.env.UPLOAD_ROOT = root;
    pool = new Pool({ connectionString: DB_URL, max: 2 });

    // 夹具用户与宠物。ON CONFLICT 是为了上一轮崩在中途时还能重跑。
    for (const [id, nickname] of [
      [AUTHOR, '可见性作者'],
      [OTHER, '另一个登录用户'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [id, `openid-${id}`, nickname],
      );
    }
    for (const [id, name] of [
      [PET, '阿黄'],
      [PET_FLIP, '阿花'],
    ]) {
      await pool.query(
        `INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date)
         VALUES ($1, $2, $3, 'dog', '中华田园犬', 'male', DATE '2024-01-01')
         ON CONFLICT (id) DO NOTHING`,
        [id, AUTHOR, name],
      );
    }

    const moduleRef = await Test.createTestingModule({ imports: [PostsModule] })
      .overrideProvider(CONTENT_SECURITY_API)
      .useValue(security)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    posts = moduleRef.get(PostsService);
    repo = moduleRef.get(POST_REPOSITORY);

    // 三条动态，发布顺序即 published_at 升序（列表按倒序返回）。
    approvedId = await publish(PET, '机审通过的动态', 'approved');
    pendingId = await publish(PET, '停在待审的动态', 'pending');
    rejectedId = await publish(PET, '被机审驳回的动态', 'rejected');
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.UPLOAD_ROOT;
    rmSync(root, { recursive: true, force: true });
    if (pool) {
      // post_images 靠 posts 的级联；pets / users 是夹具自己建的，一并收走。
      await pool.query(`DELETE FROM posts WHERE author_id = $1`, [AUTHOR]);
      await pool.query(`DELETE FROM pets WHERE owner_id = $1`, [AUTHOR]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[AUTHOR, OTHER]]);
      await pool.end();
    }
  });

  it('前置：三条动态在库里的状态确实是 approved / pending / rejected', async () => {
    const { rows } = await pool.query<{ id: string; audit_status: string }>(
      `SELECT id, audit_status FROM posts WHERE pet_id = $1 ORDER BY published_at`,
      [PET],
    );
    expect(rows).toEqual([
      { id: approvedId, audit_status: 'approved' },
      { id: pendingId, audit_status: 'pending' },
      { id: rejectedId, audit_status: 'rejected' },
    ]);
  });

  describe('1. 作者本人看得到自己的全部动态', () => {
    it('列表含 pending 与 rejected，按发布时间倒序', async () => {
      const data = await listOf(PET, AUTHOR);
      expect(data.items.map((item) => item.id)).toEqual([rejectedId, pendingId, approvedId]);
      const at = data.items.map((item) => Date.parse(item.publishedAt));
      expect(at[0]).toBeGreaterThan(at[1]);
      expect(at[1]).toBeGreaterThan(at[2]);
    });

    it('列表项带 auditStatus 供角标使用，rejected 还带驳回原因', async () => {
      const data = await listOf(PET, AUTHOR);
      const byId = new Map(data.items.map((item) => [item.id, item]));
      expect(byId.get(pendingId)?.auditStatus).toBe('pending');
      expect(byId.get(rejectedId)?.auditStatus).toBe('rejected');
      expect(byId.get(approvedId)?.auditStatus).toBe('approved');
      expect(typeof byId.get(rejectedId)?.rejectReason).toBe('string');
      expect(byId.get(rejectedId)?.rejectReason).not.toBe('');
      // 过审的没有原因可写 —— 别让客户端在 approved 上也去读这个字段。
      expect(byId.get(approvedId)?.rejectReason).toBeNull();
    });

    it('详情三条都是 200', async () => {
      for (const id of [approvedId, pendingId, rejectedId]) {
        const res = await detailOf(id, AUTHOR);
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(id);
      }
    });
  });

  describe('2. 其他登录用户看不到未过审的', () => {
    it('列表只剩 approved 那条', async () => {
      expect(await idsOf(PET, OTHER)).toEqual([approvedId]);
    });

    it('pending / rejected 的详情是 404，不是 403', async () => {
      // 403 与 404 一旦分得开，这个差别本身就把「这条动态存在」告诉了探测者。
      for (const id of [pendingId, rejectedId]) {
        const res = await detailOf(id, OTHER);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
      }
    });

    it('approved 那条的详情正常 200', async () => {
      const res = await detailOf(approvedId, OTHER);
      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe('机审通过的动态');
    });
  });

  describe('3. 未登录用户看不到未过审的', () => {
    it('列表只剩 approved 那条', async () => {
      expect(await idsOf(PET)).toEqual([approvedId]);
    });

    it('pending / rejected 的详情是 404', async () => {
      for (const id of [pendingId, rejectedId]) {
        const res = await detailOf(id);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
      }
    });

    it('approved 那条无需登录也能看', async () => {
      const res = await detailOf(approvedId);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(approvedId);
    });
  });

  describe('4. approved 之后所有人可见', () => {
    it('同一条动态从 pending 迁到 approved，三种身份的可见性一起翻过来', async () => {
      const id = await publish(PET_FLIP, '先待审，再过审', 'pending');

      // 迁移前：只有作者看得到。
      expect(await idsOf(PET_FLIP, AUTHOR)).toEqual([id]);
      expect(await idsOf(PET_FLIP, OTHER)).toEqual([]);
      expect(await idsOf(PET_FLIP)).toEqual([]);
      expect((await detailOf(id, OTHER)).status).toBe(404);
      expect((await detailOf(id)).status).toBe(404);

      // 人工复核放行走的就是这个仓储方法（pending → approved 是合法迁移）。
      // 这里直接调仓储是夹具手段：本阶段没有人工复核端点，而机审已经收敛过了。
      await repo.setAuditStatus(id, 'approved', null);

      expect(await idsOf(PET_FLIP, AUTHOR)).toEqual([id]);
      expect(await idsOf(PET_FLIP, OTHER)).toEqual([id]);
      expect(await idsOf(PET_FLIP)).toEqual([id]);
      for (const sub of [AUTHOR, OTHER, undefined]) {
        const res = await detailOf(id, sub);
        expect(res.status).toBe(200);
        expect(res.body.data.auditStatus).toBe('approved');
      }
    });
  });

  describe('5. 分页发生在过滤之后（这一条只有真库能证）', () => {
    it('作者 pageSize=2 翻两页拿齐三条', async () => {
      const first = await listOf(PET, AUTHOR, '&page=1&pageSize=2');
      expect(first.items.map((item) => item.id)).toEqual([rejectedId, pendingId]);
      expect(first.hasMore).toBe(true);

      const second = await listOf(PET, AUTHOR, '&page=2&pageSize=2');
      expect(second.items.map((item) => item.id)).toEqual([approvedId]);
      expect(second.hasMore).toBe(false);
    });

    it('未登录 pageSize=2 的第一页就是全部 —— hasMore 为 false，不是「取两条筛掉两条」', async () => {
      // 若过滤写在 LIMIT 之后：这一页会取到 rejected + pending，筛完变成 0 条，
      // 而 hasMore 还是 true —— 客户端看到一个永远取不出内容的幻影下一页。
      const data = await listOf(PET, undefined, '&page=1&pageSize=2');
      expect(data.items.map((item) => item.id)).toEqual([approvedId]);
      expect(data.hasMore).toBe(false);
    });
  });
});

/**
 * 计划里「关注流 `GET /me/feed` 同样过滤」那一条的落法。
 *
 * 本阶段没有关注流端点，所以没有第二条读路径需要断言。但「以后会有」是确定的
 * （spec §8 阶段 3），而新端点最容易漏的正好是可见性过滤。这条静态守卫在
 * 有人加出 feed 路由的那一刻变红，把人指回上面那五组断言。
 */
describe('关注流：本阶段没有 feed 端点（Global Constraint 16 的待办守卫）', () => {
  const SRC = resolve(__dirname, '..', 'src');

  function listControllers(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...listControllers(full));
      else if (entry.endsWith('.controller.ts')) out.push(full);
    }
    return out;
  }

  /** `@Get('feed')` / `@Get('me/feed')` / `@Post('feed')` 这类路由声明。 */
  const FEED_ROUTE = /@(?:Get|Post)\(\s*['"][^'"]*feed/i;

  it('没有任何控制器声明 feed 路由；加的时候请一并补可见性断言', () => {
    const controllers = listControllers(SRC);
    expect(controllers.length).toBeGreaterThan(3);
    const offenders = controllers
      .filter((file) => FEED_ROUTE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });

  it('守卫不是永真的 —— 真出现 feed 路由时能抓到', () => {
    expect(FEED_ROUTE.test(`@Get('feed')`)).toBe(true);
    expect(FEED_ROUTE.test(`@Get('me/feed')`)).toBe(true);
    expect(FEED_ROUTE.test(`@Get(':id')`)).toBe(false);
  });
});
