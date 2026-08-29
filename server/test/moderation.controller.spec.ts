import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepository,
} from '../src/moderation/audit-log.repository';
import {
  MODERATION_REPOSITORY,
  type ModerationRepository,
} from '../src/moderation/moderation.repository';
import { ModerationModule } from '../src/moderation/moderation.module';
import {
  CONTENT_SECURITY_API,
  type ContentSecurityApi,
  type ContentSecurityVerdict,
} from '../src/moderation/content-security';
import { PostsModule } from '../src/posts/posts.module';
import { PostsService } from '../src/posts/posts.service';
import { USER_ROLE_SEED } from '../src/users/user.repository';

/**
 * 复核端点（阶段 3 Task 6）：`GET /moderation/tasks` + `POST /moderation/tasks/:id/resolve`。
 *
 * 有库跑真库、无库跑内存实现，**两边同一套断言**（同 reports.controller.spec 的取向）。
 * 两处刻意的差别写在各自的断言旁边：
 *   · 无库模式的 `authorNickname` 回退成作者 id —— 内存用户仓储看不见种子用户；
 *   · 「并发复核」在无库模式下是顺序发两次（内存里没有真并发），断言的是同一件事：
 *     第二次拿 42205、不写第二条流水、不改状态。
 *
 * 本套件**不碰种子的 po-1..po-5**：复核会改状态，那几条是别的套件的读断言基础。
 */

const DB_URL = process.env.DATABASE_URL;

/** 真库模式用自己的作者与宠物；无库模式借种子（内存仓储插不进新宠物）。 */
const AUTHOR = DB_URL ? 'u-mc-author' : 'u-1';
const PET = DB_URL ? 'p-mc-1' : 'p-1';
const REPORTER = 'u-mc-reporter';
/** 运营与普通用户。真库模式落 users.role，无库模式走注入的角色种子。 */
const MODERATOR = 'u-mc-mod';
const PLAIN = 'u-mc-plain';

describe('复核 /moderation/tasks', () => {
  let app: INestApplication;
  let posts: PostsService;
  let auditLog: AuditLogRepository;
  let moderation: ModerationRepository;
  let pool: Pool | null = null;
  let root: string;

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

  /** 发一条动态并等机审收敛，返回 id。 */
  const publish = async (content: string, v: ContentSecurityVerdict = 'approved') => {
    verdict = v;
    const res = await as(http().post('/posts'), AUTHOR).send({ petId: PET, content });
    expect(res.status).toBe(201);
    await posts.settleAuditChecks();
    return res.body.data.id as string;
  };

  /** 举报一条动态 —— 工单只能这么来（本阶段机审不入队）。 */
  const report = async (id: string, reporter = REPORTER) => {
    const res = await as(http().post('/reports'), reporter).send({
      targetType: 'post',
      targetId: id,
      reason: 'spam',
    });
    expect(res.status).toBe(200);
  };

  /** 发一条 → 举报 → 回工单 id。 */
  const queued = async (content: string): Promise<{ postId: string; taskId: string }> => {
    const postId = await publish(content);
    await report(postId);
    const open = await moderation.listOpenTasksByTarget({ targetType: 'post', targetId: postId });
    expect(open).toHaveLength(1);
    return { postId, taskId: open[0].id };
  };

  const listTasks = async (sub?: string, query = '') => {
    const req = http().get(`/moderation/tasks${query}`);
    return sub ? as(req, sub) : req;
  };

  const resolve = async (taskId: string, body: Record<string, unknown>, sub?: string) => {
    const req = http().post(`/moderation/tasks/${taskId}/resolve`).send(body);
    return sub ? as(req, sub) : req;
  };

  const statusOf = async (id: string): Promise<string> => {
    const target = await moderation.findTarget({ targetType: 'post', targetId: id });
    expect(target).not.toBeNull();
    return (target as { status: string }).status;
  };

  const detailStatus = async (id: string, sub?: string): Promise<number> => {
    const req = http().get(`/posts/${id}`);
    const res = await (sub ? as(req, sub) : req);
    return res.status;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    root = mkdtempSync(join(tmpdir(), 'paws-moderation-'));
    process.env.UPLOAD_ROOT = root;

    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 4 });
      // DO UPDATE SET role：上一轮崩在中途留下的行角色可能是错的。
      for (const [id, nickname, role] of [
        [AUTHOR, '复核测试作者', 'user'],
        [REPORTER, '举报人', 'user'],
        [MODERATOR, '审核员甲', 'moderator'],
        [PLAIN, '路人', 'user'],
      ]) {
        await pool.query(
          `INSERT INTO users (id, openid, nickname, role) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, nickname = EXCLUDED.nickname`,
          [id, `openid-${id}`, nickname, role],
        );
      }
      await pool.query(
        `INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date)
         VALUES ($1, $2, '被复核的狗', 'dog', '中华田园犬', 'male', DATE '2024-01-01')
         ON CONFLICT (id) DO NOTHING`,
        [PET, AUTHOR],
      );
    }

    const builder = Test.createTestingModule({ imports: [PostsModule, ModerationModule] })
      .overrideProvider(CONTENT_SECURITY_API)
      .useValue(security);
    if (!DB_URL) {
      builder.overrideProvider(USER_ROLE_SEED).useValue({ [MODERATOR]: 'moderator' });
    }
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    posts = moduleRef.get(PostsService);
    auditLog = moduleRef.get(AUDIT_LOG_REPOSITORY);
    moderation = moduleRef.get(MODERATION_REPOSITORY);
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.UPLOAD_ROOT;
    rmSync(root, { recursive: true, force: true });
    if (pool) {
      // 夹具收尾。流水在**生产路径**上不可删（Global Constraint 25，仓储接口上
      // 压根没有 delete），但库是共享的远程实例 —— 这里用裸 pool 清自己这一轮。
      const { rows } = await pool.query<{ id: string }>(`SELECT id FROM posts WHERE pet_id = $1`, [
        PET,
      ]);
      const ids = rows.map((r) => r.id);
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
      await pool.query(`DELETE FROM posts WHERE pet_id = $1`, [PET]);
      await pool.query(`DELETE FROM pets WHERE id = $1`, [PET]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [AUTHOR, REPORTER, MODERATOR, PLAIN],
      ]);
      await pool.end();
    }
  });

  describe('5. 鉴权（先测这组：它不产生工单，不扰动下面的列表计数）', () => {
    it('未登录调两个端点都是 401', async () => {
      expect((await listTasks()).status).toBe(401);
      expect((await resolve(randomUUID(), { result: 'approved' })).status).toBe(401);
    });

    it('普通用户调两个端点都是 403', async () => {
      const list = await listTasks(PLAIN);
      expect(list.status).toBe(403);
      expect(list.body.code).toBe(ERROR_CODES.FORBIDDEN);
      const one = await resolve(randomUUID(), { result: 'approved' }, PLAIN);
      expect(one.status).toBe(403);
      expect(one.body.code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('作者本人也不能复核自己被举报的内容（他不是运营）', async () => {
      expect((await listTasks(AUTHOR)).status).toBe(403);
    });
  });

  describe('1+2. 工单列表', () => {
    let first: { postId: string; taskId: string };
    let second: { postId: string; taskId: string };

    beforeAll(async () => {
      // 先举报的先处理 —— 两条的先后顺序就是断言对象。
      first = await queued('先被举报的动态');
      second = await queued('后被举报的动态');
    });

    it('① 只出未处理的工单，按创建时间正序', async () => {
      const res = await listTasks(MODERATOR);
      expect(res.status).toBe(200);
      const ids = (res.body.data.items as { id: string }[]).map((item) => item.id);
      expect(ids).toContain(first.taskId);
      expect(ids).toContain(second.taskId);
      expect(ids.indexOf(first.taskId)).toBeLessThan(ids.indexOf(second.taskId));
    });

    it('② 列表项带被举报内容的完整原文（运营要看内容才能判）', async () => {
      const res = await listTasks(MODERATOR);
      const item = (res.body.data.items as Record<string, unknown>[]).find(
        (candidate) => candidate.id === first.taskId,
      );
      expect(item).toBeDefined();
      expect(item).toMatchObject({
        targetType: 'post',
        targetId: first.postId,
        source: 'user_report',
        reason: 'spam',
        // 内容是 pending_review 的 —— 运营不是作者，isVisibleTo 在这条路径上
        // 刻意不适用，否则运营看不见要判的东西。
        content: '先被举报的动态',
      });
      expect(Array.isArray(item?.imageUrls)).toBe(true);
      expect(typeof item?.createdAt).toBe('string');
      // 无库模式下内存用户仓储看不见种子用户，昵称回退成作者 id。
      expect(typeof item?.authorNickname).toBe('string');
      expect(item?.authorNickname).not.toBe('');
      if (DB_URL) expect(item?.authorNickname).toBe('复核测试作者');
    });

    it('② 不下发举报人是谁，也不下发 result / handledBy', async () => {
      const res = await listTasks(MODERATOR);
      const item = (res.body.data.items as Record<string, unknown>[])[0];
      // 运营按内容判，不按谁举报判 —— 下发举报人只会招来针对举报人的报复。
      expect(item).not.toHaveProperty('reportedBy');
      expect(item).not.toHaveProperty('result');
      expect(item).not.toHaveProperty('handledBy');
    });

    it('① 分页规则同其他列表：默认 10、上限 20、非法值 422', async () => {
      const first10 = await listTasks(MODERATOR);
      expect((first10.body.data.items as unknown[]).length).toBeLessThanOrEqual(10);
      expect(first10.body.data.page).toBe(1);
      expect(typeof first10.body.data.hasMore).toBe('boolean');

      const paged = await listTasks(MODERATOR, '?page=1&pageSize=1');
      expect(paged.status).toBe(200);
      expect((paged.body.data.items as unknown[]).length).toBe(1);
      expect(paged.body.data.hasMore).toBe(true);

      const second1 = await listTasks(MODERATOR, '?page=2&pageSize=1');
      expect((second1.body.data.items as { id: string }[])[0].id).not.toBe(
        (paged.body.data.items as { id: string }[])[0].id,
      );

      for (const query of ['?pageSize=21', '?page=0', '?pageSize=0', '?page=-1']) {
        const bad = await listTasks(MODERATOR, query);
        expect(bad.status).toBe(422);
        expect(bad.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });
  });

  describe('3. 复核通过 → 内容恢复可见', () => {
    let postId: string;
    let taskId: string;

    beforeAll(async () => {
      ({ postId, taskId } = await queued('复核会放行的动态'));
    });

    it('③ 状态回 approved、工单落 result 与 handledBy、写一条 review_approve 流水', async () => {
      expect(await statusOf(postId)).toBe('pending_review');
      const res = await resolve(taskId, { result: 'approved' }, MODERATOR);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ result: 'approved' });

      expect(await statusOf(postId)).toBe('approved');
      // 工单出队：未处理列表里不再有它。
      expect(
        await moderation.listOpenTasksByTarget({ targetType: 'post', targetId: postId }),
      ).toEqual([]);

      const rows = await auditLog.listByTarget('post', postId);
      // 两条：举报那条 + 这次复核。倒序，所以复核在前。
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        actorId: MODERATOR,
        action: 'review_approve',
        statusBefore: 'pending_review',
        statusAfter: 'approved',
      });
    });

    it('③ 内容对所有人重新可见', async () => {
      expect(await detailStatus(postId, AUTHOR)).toBe(200);
      expect(await detailStatus(postId, REPORTER)).toBe(200);
      expect(await detailStatus(postId)).toBe(200);
    });

    it('③ 放行后这条工单不再出现在列表里', async () => {
      const res = await listTasks(MODERATOR);
      const ids = (res.body.data.items as { id: string }[]).map((item) => item.id);
      expect(ids).not.toContain(taskId);
    });
  });

  describe('4. 复核驳回 → 永久撤下', () => {
    let postId: string;
    let taskId: string;

    beforeAll(async () => {
      ({ postId, taskId } = await queued('复核会驳回的动态'));
    });

    it('④ 状态到 rejected，流水 action 是 review_reject', async () => {
      const res = await resolve(
        taskId,
        { result: 'rejected', rejectReason: '确认为垃圾广告' },
        MODERATOR,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ result: 'rejected' });
      expect(await statusOf(postId)).toBe('rejected');

      const rows = await auditLog.listByTarget('post', postId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        actorId: MODERATOR,
        action: 'review_reject',
        statusBefore: 'pending_review',
        statusAfter: 'rejected',
      });
    });

    it('④ 对他人与未登录不可见，作者看得见并且拿到驳回原因', async () => {
      expect(await detailStatus(postId, REPORTER)).toBe(404);
      expect(await detailStatus(postId)).toBe(404);

      const mine = await as(http().get(`/posts/${postId}`), AUTHOR);
      expect(mine.status).toBe(200);
      expect(mine.body.data.auditStatus).toBe('rejected');
      expect(mine.body.data.rejectReason).toBe('确认为垃圾广告');
    });
  });

  describe('6. 并发复核：第二次拿 42205，且什么都不改', () => {
    let postId: string;
    let taskId: string;

    beforeAll(async () => {
      ({ postId, taskId } = await queued('会被复核两次的动态'));
    });

    it('⑥ 同时发两次，一次成功一次 MODERATION_TASK_HANDLED', async () => {
      // 真库上是真并发（部分唯一索引与带条件 UPDATE 各自兜一半）；
      // 无库模式下 Promise.all 会被内存实现顺序化，断言的仍是同一件事。
      const [a, b] = await Promise.all([
        resolve(taskId, { result: 'approved' }, MODERATOR),
        resolve(taskId, { result: 'rejected', rejectReason: '同时驳回' }, MODERATOR),
      ]);
      const codes = [a.status, b.status].sort();
      expect(codes).toEqual([200, 422]);

      const loser = a.status === 422 ? a : b;
      expect(loser.body.code).toBe(ERROR_CODES.MODERATION_TASK_HANDLED);
    });

    it('⑥ 只写了一条复核流水、状态只迁了一次', async () => {
      const rows = await auditLog.listByTarget('post', postId);
      // 举报 1 条 + 复核 1 条。败者那次一条都不写。
      expect(rows).toHaveLength(2);
      const status = await statusOf(postId);
      // 赢者是谁不确定，但状态一定是那一次的结论，且工单已出队。
      expect(['approved', 'rejected']).toContain(status);
      expect(rows[0].statusAfter).toBe(status);
      expect(
        await moderation.listOpenTasksByTarget({ targetType: 'post', targetId: postId }),
      ).toEqual([]);
    });

    it('⑥ 已处理的工单再复核一次仍是 42205', async () => {
      const again = await resolve(taskId, { result: 'approved' }, MODERATOR);
      expect(again.status).toBe(422);
      expect(again.body.code).toBe(ERROR_CODES.MODERATION_TASK_HANDLED);
      expect(await auditLog.listByTarget('post', postId)).toHaveLength(2);
    });
  });

  describe('入参与不存在的工单', () => {
    it('不存在的工单 id → 404', async () => {
      const res = await resolve(randomUUID(), { result: 'approved' }, MODERATOR);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('result 不是 approved / rejected → 422 VALIDATION_FAILED', async () => {
      const { postId, taskId } = await queued('入参校验用的动态');
      for (const result of ['pending', '乱值', undefined, '', 42]) {
        const res = await resolve(taskId, { result }, MODERATOR);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
      // 校验失败不该动状态、不该关工单 —— 非法入参不能走到仓储去。
      expect(await statusOf(postId)).toBe('pending_review');
      expect(
        await moderation.listOpenTasksByTarget({ targetType: 'post', targetId: postId }),
      ).toHaveLength(1);
    });
  });
});
