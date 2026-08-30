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
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../src/common/rate-limit/rate-limit.store';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import {
  CONTENT_SECURITY_API,
  type ContentSecurityApi,
  type ContentSecurityVerdict,
} from '../src/moderation/content-security';
import { FOLLOW_REPOSITORY, type FollowRepository } from '../src/follows/follow.repository';
import { MeModule } from '../src/me/me.module';
import { ModerationModule } from '../src/moderation/moderation.module';
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
 * 关于计划里「关注流 `GET /me/feed` 同样过滤」那一条：第 7 组就是它
 * （阶段 3 Task 7 把端点做出来了）。文件末尾那条静态守卫随之从「不许有 feed 路由」
 * 改成「有 feed 路由就必须有那一组断言」。
 */

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

/**
 * 第 7 组（feed 可见性）注册过没有。
 *
 * 文件末尾那条静态守卫读它 —— 「有 feed 路由就必须有 feed 可见性断言」这条蕴含
 * 关系，判据不能是「扫本文件的文本找关键词」（正则自己就写在本文件里，一定命中，
 * 等于空转）。让那一组在注册时置位是唯一诚实的判据：组被删掉或改名，这个标志
 * 就不会被置上，守卫立刻变红。
 *
 * `describe.skip` 的回调仍会执行（它只把里面的 `it` 标成跳过），所以无库模式下
 * 那一组整组 skip，这个标志照样是 true —— 守卫本身与门控无关，两种模式都该跑。
 */
let feedVisibilityAsserted = false;

describeDb('动态可见性（Global Constraint 16 · 真库门控）', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let posts: PostsService;
  let repo: PostRepository;
  let follows: FollowRepository;
  let pool: Pool;
  let root: string;

  /** 夹具：作者、另一个登录用户、两只宠物（第二只专供「过审后可见」那条，免得扰动计数）。 */
  const AUTHOR = 'u-vis-author';
  const OTHER = 'u-vis-other';
  const PET = 'p-vis-1';
  const PET_FLIP = 'p-vis-2';
  /** 举报那组用自己的宠物：它的列表条数会被举报改写，不能扰动上面几组的计数。 */
  const PET_REPORT = 'p-vis-3';
  /** 关注流那组：被 FOLLOWER 关注的宠物。它的动态会进 FOLLOWER 的 feed。 */
  const PET_FEED = 'p-vis-4';
  /** 关注 PET_FEED 的人。他不是作者 —— 这一组要证的正是「关注者也看不到未过审的」。 */
  const FOLLOWER = 'u-vis-follower';

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
      [FOLLOWER, '关注者'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
        [id, `openid-${id}`, nickname],
      );
    }
    for (const [id, name] of [
      [PET, '阿黄'],
      [PET_FLIP, '阿花'],
      [PET_REPORT, '阿灰'],
      [PET_FEED, '阿白'],
    ]) {
      await pool.query(
        `INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date)
         VALUES ($1, $2, $3, 'dog', '中华田园犬', 'male', DATE '2024-01-01')
         ON CONFLICT (id) DO NOTHING`,
        [id, AUTHOR, name],
      );
    }

    // ModerationModule 是第 6 组要的：那组走真的 `POST /reports`，不手改状态 ——
    // 「举报导致 approved → pending_review」这条边的可见性后果得由端点自己产生。
    // MeModule 是第 7 组（关注流）要的：`GET /me/feed` 挂在那里。
    const moduleRef = await Test.createTestingModule({
      imports: [PostsModule, ModerationModule, MeModule],
    })
      .overrideProvider(CONTENT_SECURITY_API)
      .useValue(security)
      // 限流关掉：第 6 组走真的 `POST /reports`，而本套件验的是可见性 ——
      // 不覆盖的话每次举报都要等 Redis 超时 2s 才降级放行。限流有自己的套件。
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue({ increment: async () => 0 } satisfies RateLimitStore)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    posts = moduleRef.get(PostsService);
    repo = moduleRef.get(POST_REPOSITORY);
    follows = moduleRef.get(FOLLOW_REPOSITORY);

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
      // 第 6 组举报出来的流水与工单先收走：库是共享的远程实例，
      // 留下的行会让走查数不清（audit_log 在生产路径上不可删，这里用裸 pool，
      // 不经仓储 —— 仓储接口上压根没有 delete，Global Constraint 25）。
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM posts WHERE author_id = $1`,
        [AUTHOR],
      );
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await pool.query(
          `DELETE FROM audit_log WHERE target_type = 'post' AND target_id = ANY($1)`,
          [ids],
        );
        await pool.query(
          `DELETE FROM moderation_tasks WHERE target_type = 'post' AND target_id = ANY($1)`,
          [ids],
        );
      }
      // post_images 靠 posts 的级联；pets / users 是夹具自己建的，一并收走。
      // follows 也得先删：它的外键指向 pets（ON DELETE CASCADE 会跟着走，
      // 但显式删掉更好读，也不依赖那条级联的方向）。
      await pool.query(`DELETE FROM follows WHERE follower_id = ANY($1)`, [[FOLLOWER, AUTHOR]]);
      await pool.query(`DELETE FROM posts WHERE author_id = $1`, [AUTHOR]);
      await pool.query(`DELETE FROM pets WHERE owner_id = $1`, [AUTHOR]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[AUTHOR, OTHER, FOLLOWER]]);
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

  describe('6. 举报导致的 approved → pending_review 同样翻转可见性（阶段 3 Task 4）', () => {
    it('举报之后：作者仍可见，他人与未登录 404 —— 三种身份一起翻过来', async () => {
      const id = await publish(PET_REPORT, '会被举报的动态', 'approved');

      // 举报前：过审内容，三种身份都看得到。
      expect(await idsOf(PET_REPORT, AUTHOR)).toEqual([id]);
      expect(await idsOf(PET_REPORT, OTHER)).toEqual([id]);
      expect(await idsOf(PET_REPORT)).toEqual([id]);

      // 走真的举报端点，不手改状态：这一组要证的正是「端点产生的那次迁移」
      // 在 SQL 的可见性过滤上确实生效（内存实现是另一份代码，见文件头注释）。
      const res = await as(http().post('/reports'), OTHER).send({
        targetType: 'post',
        targetId: id,
        reason: 'spam',
      });
      expect(res.status).toBe(200);

      const { rows } = await pool.query<{ audit_status: string }>(
        `SELECT audit_status FROM posts WHERE id = $1`,
        [id],
      );
      expect(rows[0].audit_status).toBe('pending_review');

      // 作者仍看得见（他要知道自己的内容被撤下复核了）。
      expect(await idsOf(PET_REPORT, AUTHOR)).toEqual([id]);
      expect((await detailOf(id, AUTHOR)).status).toBe(200);

      // 举报人自己也看不见了 —— pending_review 对非作者一律不可见。
      expect(await idsOf(PET_REPORT, OTHER)).toEqual([]);
      expect(await idsOf(PET_REPORT)).toEqual([]);
      for (const sub of [OTHER, undefined]) {
        const detail = await detailOf(id, sub);
        expect(detail.status).toBe(404);
        expect(detail.body.code).toBe(ERROR_CODES.NOT_FOUND);
      }
    });
  });

  /**
   * 关注流的可见性（Global Constraint 29 · 阶段 3 Task 7）。
   *
   * 这一组的标题与下面那条静态守卫的正则是**配对的** —— 守卫扫本文件自身，
   * 断言「有 feed 路由时必须有 feed 可见性断言」。改标题记得同时改那条正则。
   */
  describe('7. 关注流 feed 的可见性：未过审的内容不进任何人的 feed', () => {
    // 向文件末尾那条静态守卫报到。写在这里而不是组外：这一行与这一组同生共死，
    // 组被删掉时标志自然不会置上。
    feedVisibilityAsserted = true;

    let feedApproved: string;
    let feedPending: string;

    beforeAll(async () => {
      // FOLLOWER 关注 PET_FEED。直接写仓储当夹具 —— `POST /pets/:id/follow`
      // 有自己的套件，这里要的只是「已经关注了」这个前置状态。
      await follows.follow(FOLLOWER, PET_FEED);
      feedApproved = await publish(PET_FEED, 'feed 里该出现的动态', 'approved');
      feedPending = await publish(PET_FEED, 'feed 里不该出现的待审动态', 'pending');
    });

    const feedIds = async (sub?: string): Promise<string[]> => {
      const req = http().get('/me/feed?pageSize=20');
      const res = await (sub ? as(req, sub) : req);
      expect(res.status).toBe(200);
      return (res.body.data.items as { id: string }[]).map((item) => item.id);
    };

    it('关注者能看到过审的那条', async () => {
      expect(await feedIds(FOLLOWER)).toContain(feedApproved);
    });

    it('关注者看不到 pending 的那条（他不是作者）', async () => {
      expect(await feedIds(FOLLOWER)).not.toContain(feedPending);
    });

    it('作者自己调 feed 时那条也不出现 —— feed 没有作者例外', async () => {
      // 作者没关注自己的宠物，所以他的 feed 里本来就没有 PET_FEED 的动态。
      // 但即使硬把关注关系写进去，pending 那条也不该出现：feed 的 WHERE 里
      // **不许**有 `OR author_id = viewer`，加了它自己的待审内容会漏进 feed。
      await follows.follow(AUTHOR, PET_FEED);
      try {
        const ids = await feedIds(AUTHOR);
        expect(ids).not.toContain(feedPending);
        // 自己发的动态一条都不进自己的 feed（Global Constraint 30），
        // 所以过审那条也不在。
        expect(ids).not.toContain(feedApproved);
      } finally {
        await follows.unfollow(AUTHOR, PET_FEED);
      }
    });

    it('未登录调 feed 是 401（feed 是「我的」数据）', async () => {
      const res = await http().get('/me/feed');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });
  });
});

/**
 * 关注流的可见性守卫（阶段 3 Task 8 改造）。
 *
 * 原先它断言「没有任何控制器声明 feed 路由」—— 那是 Task 7 之前的形状，
 * feed 端点一落地它就必然变红（设计好的红，不是回归）。现在改成断言那条
 * **蕴含关系**：源码里有 feed 路由，就必须有配套的 feed 可见性断言。
 *
 * 「有没有断言」不靠扫本文件的文本判断 —— 那会立刻空转：判据的正则本身就写在
 * 这个文件里，扫自己一定命中。改成让第 7 组**自注册**：`describe` 的回调在收集
 * 阶段就会执行（`describe.skip` 也一样，它只是把里面的 `it` 标记成跳过），
 * 所以无库模式下那一组虽然整组 skip，注册这件事照样发生。
 *
 * 守卫仍放在门控 describe **之外**：它是静态检查，两种模式下都该跑。
 */
describe('关注流：有 feed 路由就必须有 feed 可见性断言（Global Constraint 29 的守卫）', () => {
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

  /** 哪些控制器声明了 feed 路由。抽成函数，好让下面那条反向断言拿假数据喂它。 */
  const feedRoutesIn = (sources: { file: string; text: string }[]): string[] =>
    sources.filter((source) => FEED_ROUTE.test(source.text)).map((source) => source.file);

  const controllerSources = () =>
    listControllers(SRC).map((file) => ({
      file: relative(SRC, file).replace(/\\/g, '/'),
      text: readFileSync(file, 'utf8'),
    }));

  it('有 feed 路由 → 必须有 feed 可见性断言（加端点时请一并补那一组）', () => {
    const sources = controllerSources();
    expect(sources.length).toBeGreaterThan(3);
    const withFeed = feedRoutesIn(sources);
    // 蕴含关系：没有 feed 路由时这条自然成立（下一条断言负责证明那不是空转）。
    if (withFeed.length > 0) {
      expect(feedVisibilityAsserted).toBe(true);
    }
  });

  it('本阶段确实有 feed 路由，所以上面那条不是空转', () => {
    // Task 7 之后 `/me/feed` 就在 MeController 上。这条一旦变红，说明 feed 端点
    // 被挪走或删了 —— 那时上面那条蕴含式会退化成永真，得跟着一起重新想。
    expect(feedRoutesIn(controllerSources()).length).toBeGreaterThan(0);
  });

  it('守卫不是永真的 —— 正则抓得住 feed 路由，也不会误伤别的路由', () => {
    expect(FEED_ROUTE.test(`@Get('feed')`)).toBe(true);
    expect(FEED_ROUTE.test(`@Get('me/feed')`)).toBe(true);
    expect(FEED_ROUTE.test(`@Get(':id')`)).toBe(false);
    // 判据函数本身也喂一遍假数据：有 feed 的挑出来、没 feed 的不挑。
    expect(
      feedRoutesIn([
        { file: 'a.controller.ts', text: `@Get('feed')` },
        { file: 'b.controller.ts', text: `@Get(':id')` },
      ]),
    ).toEqual(['a.controller.ts']);
    expect(feedRoutesIn([{ file: 'b.controller.ts', text: `@Get(':id')` }])).toEqual([]);
  });
});
