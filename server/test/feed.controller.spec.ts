import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { FOLLOW_REPOSITORY, type FollowRepository } from '../src/follows/follow.repository';
import { MeModule } from '../src/me/me.module';
import {
  CONTENT_SECURITY_API,
  type ContentSecurityApi,
  type ContentSecurityVerdict,
} from '../src/moderation/content-security';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';

/**
 * 关注流 `GET /me/feed`（阶段 3 Task 7）。
 *
 * 有库跑真库、无库跑内存实现，**两边同一套断言**。两种模式的差别只在夹具：
 * 真库能插自己的用户与宠物，无库插不进宠物（那是另一个仓储的种子），所以借
 * 种子的 p-1 / p-2 / p-5 与它们的主人。
 *
 * 断言一律按**本轮发的那几条 id** 来（包含 / 不包含 / 相对先后），不数整页条数：
 * 借了种子宠物就意味着页面上还有种子动态，而真库是共享实例，别的套件也在往里发。
 */

const DB_URL = process.env.DATABASE_URL;

/** 看 feed 的人。他关注 PET_A 与 PET_B，自己拥有 PET_MINE。 */
const VIEWER = DB_URL ? 'u-feed-viewer' : 'u-1';
/** 两个被关注宠物的主人 —— feed 里出现的动态都是他们发的。 */
const AUTHOR_A = DB_URL ? 'u-feed-a' : 'u-2';
const AUTHOR_B = DB_URL ? 'u-feed-b' : 'u-5';
const PET_A = DB_URL ? 'p-feed-a' : 'p-2';
const PET_B = DB_URL ? 'p-feed-b' : 'p-5';
/** 看 feed 的人自己的宠物。Global Constraint 30：自己的动态不进自己的 feed。 */
const PET_MINE = DB_URL ? 'p-feed-mine' : 'p-1';
/** 一只都没关注的人。 */
const LONER = 'u-feed-loner';

describe('关注流 GET /me/feed', () => {
  let app: INestApplication;
  let posts: PostsService;
  let follows: FollowRepository;
  let pool: Pool | null = null;
  let root: string;

  /** 本轮发的动态 id。 */
  let fromA: string;
  let fromB: string;
  let pendingFromA: string;
  let rejectedFromB: string;
  let mine: string;

  let verdict: ContentSecurityVerdict = 'approved';
  const security: ContentSecurityApi = {
    checkText: async () => verdict,
    checkImage: async () => verdict,
  };

  const http = () => request(app.getHttpServer());
  const tokenFor = (sub: string) =>
    sign({ openid: `openid-${sub}` }, 'test-secret', { subject: sub });
  const as = (req: request.Test, sub: string) =>
    req.set('Authorization', `Bearer ${tokenFor(sub)}`);

  /** 发一条动态并等机审收敛。作者必须是宠物的主人（发布端点自己会查）。 */
  const publish = async (
    author: string,
    petId: string,
    content: string,
    v: ContentSecurityVerdict = 'approved',
  ): Promise<string> => {
    verdict = v;
    const res = await as(http().post('/posts'), author).send({ petId, content });
    expect(res.status).toBe(201);
    await posts.settleAuditChecks();
    return res.body.data.id as string;
  };

  const feed = async (sub?: string, query = '') => {
    const req = http().get(`/me/feed${query}`);
    return sub ? as(req, sub) : req;
  };

  /** feed 里这一页的动态 id。 */
  const feedIds = async (sub: string, query = ''): Promise<string[]> => {
    const res = await feed(sub, query);
    expect(res.status).toBe(200);
    return (res.body.data.items as { id: string }[]).map((item) => item.id);
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    root = mkdtempSync(join(tmpdir(), 'paws-feed-'));
    process.env.UPLOAD_ROOT = root;

    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      for (const [id, nickname] of [
        [VIEWER, 'feed 观众'],
        [AUTHOR_A, 'feed 作者甲'],
        [AUTHOR_B, 'feed 作者乙'],
        [LONER, '谁也没关注的人'],
      ]) {
        await pool.query(
          `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO NOTHING`,
          [id, `openid-${id}`, nickname],
        );
      }
      for (const [id, owner, name] of [
        [PET_A, AUTHOR_A, '甲的狗'],
        [PET_B, AUTHOR_B, '乙的猫'],
        [PET_MINE, VIEWER, '我自己的狗'],
      ]) {
        await pool.query(
          `INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date)
           VALUES ($1, $2, $3, 'dog', '中华田园犬', 'male', DATE '2024-01-01')
           ON CONFLICT (id) DO NOTHING`,
          [id, owner, name],
        );
      }
    }

    const moduleRef = await Test.createTestingModule({ imports: [MeModule, PostsModule] })
      .overrideProvider(CONTENT_SECURITY_API)
      .useValue(security)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    posts = moduleRef.get(PostsService);
    follows = moduleRef.get(FOLLOW_REPOSITORY);

    // 关注关系直接写仓储当夹具：`POST /pets/:id/follow` 那条路径有自己的套件，
    // 这里要的只是「已经关注了」这个前置状态。
    await follows.follow(VIEWER, PET_A);
    await follows.follow(VIEWER, PET_B);

    // 发布顺序即 published_at 升序，feed 按倒序返回。
    fromA = await publish(AUTHOR_A, PET_A, 'feed：甲的第一条');
    pendingFromA = await publish(AUTHOR_A, PET_A, 'feed：甲的待审动态', 'pending');
    rejectedFromB = await publish(AUTHOR_B, PET_B, 'feed：乙的被驳回动态', 'rejected');
    fromB = await publish(AUTHOR_B, PET_B, 'feed：乙的第一条');
    mine = await publish(VIEWER, PET_MINE, 'feed：我自己发的');
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.UPLOAD_ROOT;
    rmSync(root, { recursive: true, force: true });
    if (pool) {
      await pool.query(`DELETE FROM follows WHERE follower_id = $1`, [VIEWER]);
      // post_images 靠 posts 的级联。
      await pool.query(`DELETE FROM posts WHERE pet_id = ANY($1)`, [[PET_A, PET_B, PET_MINE]]);
      await pool.query(`DELETE FROM pets WHERE id = ANY($1)`, [[PET_A, PET_B, PET_MINE]]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [VIEWER, AUTHOR_A, AUTHOR_B, LONER],
      ]);
      await pool.end();
    }
  });

  describe('1. 只出关注的宠物的动态，跨宠物按时间倒序混排', () => {
    it('① 两只被关注宠物的过审动态都在，且乙的（更晚发）排在甲的前面', async () => {
      const ids = await feedIds(VIEWER, '?pageSize=20');
      expect(ids).toContain(fromA);
      expect(ids).toContain(fromB);
      // 跨宠物混排：判据是相对先后，不是「按宠物分组」。
      expect(ids.indexOf(fromB)).toBeLessThan(ids.indexOf(fromA));
    });

    it('① 没关注的宠物的动态不在（PET_MINE 之外还有种子里的别人）', async () => {
      const ids = await feedIds(VIEWER, '?pageSize=20');
      // 本轮唯一确定「没被关注」的宠物就是自己那只 —— 它同时也是断言 ② 的对象。
      expect(ids).not.toContain(mine);
    });

    it('① 每一项都带 petName 与 auditStatus（客户端要显示是谁发的）', async () => {
      const res = await feed(VIEWER, '?pageSize=20');
      const item = (res.body.data.items as Record<string, unknown>[]).find(
        (candidate) => candidate.id === fromB,
      );
      expect(item).toBeDefined();
      expect(typeof item?.petName).toBe('string');
      expect(item?.petName).not.toBe('');
      expect(item?.auditStatus).toBe('approved');
      expect(item?.petId).toBe(PET_B);
    });
  });

  describe('2. 不含自己的动态（Global Constraint 30）', () => {
    it('② 自己发的那条不在 feed 里 —— 即使自己也在关注列表的语义里', async () => {
      const ids = await feedIds(VIEWER, '?pageSize=20');
      expect(ids).not.toContain(mine);
    });

    it('② 就算硬把自己的宠物写进关注表，自己的动态也不该出现', async () => {
      // `POST /pets/:id/follow` 会拦下关注自己（FOLLOW_SELF），但仓储层拦不住 ——
      // feed 的 SQL 不能依赖「关注表里不会有自己的宠物」这个假设。
      await follows.follow(VIEWER, PET_MINE);
      try {
        const ids = await feedIds(VIEWER, '?pageSize=20');
        expect(ids).not.toContain(mine);
      } finally {
        await follows.unfollow(VIEWER, PET_MINE);
      }
    });
  });

  describe('可见性：feed 里没有未过审的内容（Global Constraint 29）', () => {
    it('被关注宠物的 pending 动态不在 feed 里（看的人不是作者）', async () => {
      const ids = await feedIds(VIEWER, '?pageSize=20');
      expect(ids).not.toContain(pendingFromA);
    });

    it('被关注宠物的 rejected 动态也不在', async () => {
      const ids = await feedIds(VIEWER, '?pageSize=20');
      expect(ids).not.toContain(rejectedFromB);
    });

    it('作者自己调 feed 时也看不到那条 —— feed 不做「作者例外」', async () => {
      // 作者没关注自己的宠物，所以他的 feed 里本来就没有它。
      // 这一条钉的是「feed 的 WHERE 里不许有 OR author_id = viewer」：
      // 加了那个条件，自己的 pending 内容会从 feed 漏出来。
      await follows.follow(AUTHOR_A, PET_A);
      try {
        const ids = await feedIds(AUTHOR_A, '?pageSize=20');
        expect(ids).not.toContain(pendingFromA);
        expect(ids).not.toContain(fromA);
      } finally {
        await follows.unfollow(AUTHOR_A, PET_A);
      }
    });
  });

  describe('3. 一只都没关注 → 空列表，不是 404', () => {
    it('③ items 为空、hasMore 为 false、状态码 200', async () => {
      const res = await feed(LONER);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.hasMore).toBe(false);
      expect(res.body.data.page).toBe(1);
    });
  });

  describe('4. 分页规则同其他列表', () => {
    it('④ pageSize=1 翻两页能分别拿到乙的与甲的那条', async () => {
      const first = await feed(VIEWER, '?page=1&pageSize=1');
      expect(first.status).toBe(200);
      expect((first.body.data.items as unknown[]).length).toBe(1);
      // 最新的那条在第一页第一位。
      expect((first.body.data.items as { id: string }[])[0].id).toBe(fromB);
      expect(first.body.data.hasMore).toBe(true);

      const second = await feed(VIEWER, '?page=2&pageSize=1');
      expect((second.body.data.items as { id: string }[])[0].id).toBe(fromA);
    });

    it('④ 默认 pageSize 是 10、page 是 1', async () => {
      const res = await feed(VIEWER);
      expect((res.body.data.items as unknown[]).length).toBeLessThanOrEqual(10);
      expect(res.body.data.page).toBe(1);
    });

    it('④ 非法分页参数 → 422', async () => {
      for (const query of ['?pageSize=21', '?page=0', '?pageSize=0', '?page=-1', '?page=1.5']) {
        const res = await feed(VIEWER, query);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });
  });

  describe('5. 未登录', () => {
    it('⑤ 未登录 401（feed 是「我的」数据）', async () => {
      const res = await feed();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });
  });
});
