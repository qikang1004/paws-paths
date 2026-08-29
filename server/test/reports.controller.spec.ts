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

/**
 * `POST /reports` —— 举报端点（阶段 3 Task 4）。
 *
 * 有库跑真库、无库跑内存实现，**两边同一套断言**（同 favorites.controller.spec 的取向）。
 * 两种模式唯一的差别是夹具：真库要先把用户和宠物插进去（posts 有外键），
 * 无库模式插不进去，所以直接借种子里的 p-1 / u-1 当作者。
 *
 * 本套件刻意**不碰种子的 po-1..po-5**：举报会改状态，而那几条是别的套件的读断言基础。
 * 每组用例自己发一条新动态。
 */

const DB_URL = process.env.DATABASE_URL;

/** 真库模式用自己的作者与宠物；无库模式借种子（内存仓储插不进新宠物）。 */
const AUTHOR = DB_URL ? 'u-rep-author' : 'u-1';
const PET = DB_URL ? 'p-rep-1' : 'p-1';
/** 举报人：两个不同的人，验「不同人重复举报也幂等」。都不是作者。 */
const REPORTER = 'u-rep-reporter';
const OTHER_REPORTER = 'u-rep-other';

describe('举报 POST /reports', () => {
  let app: INestApplication;
  let posts: PostsService;
  let auditLog: AuditLogRepository;
  let moderation: ModerationRepository;
  let pool: Pool | null = null;
  let root: string;

  /** 机审裁决由 publish() 的调用方指定 —— 举报的前置条件是内容已经 approved。 */
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

  /** 发一条动态并等机审收敛，返回 id。响应恒为 pending —— 机审是后台的事。 */
  const publish = async (content: string, v: ContentSecurityVerdict): Promise<string> => {
    verdict = v;
    const res = await as(http().post('/posts'), AUTHOR).send({ petId: PET, content });
    expect(res.status).toBe(201);
    await posts.settleAuditChecks();
    return res.body.data.id as string;
  };

  /** 举报。`sub` 为 undefined 时不带令牌（未登录）。 */
  const report = async (
    body: Record<string, unknown>,
    sub?: string,
  ): Promise<request.Response> => {
    const req = http().post('/reports').send(body);
    return sub ? as(req, sub) : req;
  };

  const reportPost = (id: string, sub?: string) =>
    report({ targetType: 'post', targetId: id, reason: 'spam' }, sub);

  /** 这个人看不看得见这条动态：200 还是 404。 */
  const detailStatus = async (id: string, sub?: string): Promise<number> => {
    const req = http().get(`/posts/${id}`);
    const res = await (sub ? as(req, sub) : req);
    return res.status;
  };

  /** 库里/内存里这条动态当前的审核状态。 */
  const statusOf = async (id: string): Promise<string> => {
    const target = await moderation.findTarget({ targetType: 'post', targetId: id });
    expect(target).not.toBeNull();
    return (target as { status: string }).status;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    root = mkdtempSync(join(tmpdir(), 'paws-reports-'));
    process.env.UPLOAD_ROOT = root;

    if (DB_URL) {
      pool = new Pool({ connectionString: DB_URL, max: 2 });
      // ON CONFLICT 是为了上一轮崩在中途时还能重跑。
      for (const [id, nickname] of [
        [AUTHOR, '举报测试作者'],
        [REPORTER, '举报人甲'],
        [OTHER_REPORTER, '举报人乙'],
      ]) {
        await pool.query(
          `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO NOTHING`,
          [id, `openid-${id}`, nickname],
        );
      }
      await pool.query(
        `INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date)
         VALUES ($1, $2, '被举报的狗', 'dog', '中华田园犬', 'male', DATE '2024-01-01')
         ON CONFLICT (id) DO NOTHING`,
        [PET, AUTHOR],
      );
    }

    const moduleRef = await Test.createTestingModule({
      imports: [PostsModule, ModerationModule],
    })
      .overrideProvider(CONTENT_SECURITY_API)
      .useValue(security)
      .compile();
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
      // 夹具收尾。audit_log 在**生产路径**上不可删（Global Constraint 25，仓储接口
      // 上压根没有 delete），但库是共享的远程实例，测试留下的流水会让走查数不清 ——
      // 这里用裸 pool 清自己这一轮的行，不经仓储。
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM posts WHERE pet_id = $1`,
        [PET],
      );
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        await pool.query(`DELETE FROM audit_log WHERE target_type = 'post' AND target_id = ANY($1)`, [ids]);
        await pool.query(
          `DELETE FROM moderation_tasks WHERE target_type = 'post' AND target_id = ANY($1)`,
          [ids],
        );
      }
      await pool.query(`DELETE FROM posts WHERE pet_id = $1`, [PET]);
      await pool.query(`DELETE FROM pets WHERE id = $1`, [PET]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [AUTHOR, REPORTER, OTHER_REPORTER],
      ]);
      await pool.end();
    }
  });

  describe('1. 举报别人 approved 的动态', () => {
    let target: string;

    beforeAll(async () => {
      target = await publish('这条会被举报', 'approved');
    });

    it('① 返回 200，状态迁到 pending_review', async () => {
      expect(await statusOf(target)).toBe('approved');
      const res = await reportPost(target, REPORTER);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(ERROR_CODES.OK);
      expect(await statusOf(target)).toBe('pending_review');
    });

    it('② 迁移后举报人自己也看不到了，作者仍看得见', async () => {
      // pending_review 对非作者立即不可见 —— 内容被举报后先撤下再复核。
      expect(await detailStatus(target, REPORTER)).toBe(404);
      expect(await detailStatus(target, OTHER_REPORTER)).toBe(404);
      expect(await detailStatus(target)).toBe(404);
      expect(await detailStatus(target, AUTHOR)).toBe(200);
    });

    it('③ 写了一条 audit_log：report / approved → pending_review / actor 是举报人', async () => {
      const rows = await auditLog.listByTarget('post', target);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: REPORTER,
        action: 'report',
        targetType: 'post',
        targetId: target,
        statusBefore: 'approved',
        statusAfter: 'pending_review',
      });
    });

    it('④ 入了一条 moderation_tasks：source user_report、result 为 null', async () => {
      const tasks = await moderation.listOpenTasksByTarget({
        targetType: 'post',
        targetId: target,
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        targetType: 'post',
        targetId: target,
        source: 'user_report',
        reportedBy: REPORTER,
        reason: 'spam',
        result: null,
        handledBy: null,
        handledAt: null,
      });
    });

    it('⑤ 重复举报幂等：同一人再报、另一个人也报，都 200，工单仍 1 条、流水不新增', async () => {
      const again = await reportPost(target, REPORTER);
      expect(again.status).toBe(200);
      const byOther = await reportPost(target, OTHER_REPORTER);
      expect(byOther.status).toBe(200);

      const tasks = await moderation.listOpenTasksByTarget({
        targetType: 'post',
        targetId: target,
      });
      expect(tasks).toHaveLength(1);
      // 工单还挂在第一个举报人身上，没被后来者改写。
      expect(tasks[0].reportedBy).toBe(REPORTER);
      expect(await auditLog.listByTarget('post', target)).toHaveLength(1);
      expect(await statusOf(target)).toBe('pending_review');
    });
  });

  describe('2. 看不见的目标一律 404，且四种情况响应一字不差（Global Constraint 26）', () => {
    let pendingId: string;
    let rejectedId: string;
    let otherPendingId: string;

    beforeAll(async () => {
      pendingId = await publish('停在待审的动态', 'pending');
      rejectedId = await publish('被机审驳回的动态', 'rejected');
      otherPendingId = await publish('另一条待审的动态', 'pending');
    });

    it('四种情况的响应体完全一致', async () => {
      const bodies: unknown[] = [];
      for (const id of [pendingId, rejectedId, `po-${randomUUID()}`, otherPendingId]) {
        const res = await reportPost(id, REPORTER);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
        bodies.push(res.body);
      }
      // 一字不差：状态机不允许 pending → pending_review，但那个非法迁移
      // **不能**以 422 的形式暴露出去，否则「这条 id 存在」就泄露了。
      for (const body of bodies.slice(1)) {
        expect(body).toEqual(bodies[0]);
      }
    });

    it('404 的那几条状态没被改动，也没写流水、没入队', async () => {
      for (const id of [pendingId, otherPendingId]) {
        expect(await statusOf(id)).toBe('pending');
      }
      expect(await statusOf(rejectedId)).toBe('rejected');
      for (const id of [pendingId, rejectedId, otherPendingId]) {
        expect(await auditLog.listByTarget('post', id)).toEqual([]);
        expect(
          await moderation.listOpenTasksByTarget({ targetType: 'post', targetId: id }),
        ).toEqual([]);
      }
    });
  });

  describe('3. 鉴权与入参', () => {
    let target: string;

    beforeAll(async () => {
      target = await publish('入参校验用的动态', 'approved');
    });

    it('⑦ 未登录 401', async () => {
      const res = await reportPost(target);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('⑦ target_type 传 pet_photo → 422 MODERATION_TARGET_INVALID', async () => {
      const res = await report(
        { targetType: 'pet_photo', targetId: target, reason: 'spam' },
        REPORTER,
      );
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.MODERATION_TARGET_INVALID);
    });

    it('⑦ target_type 传乱值或缺失 → 422 MODERATION_TARGET_INVALID', async () => {
      for (const targetType of ['乱值', '', 'POST', undefined, 42]) {
        const res = await report({ targetType, targetId: target, reason: 'spam' }, REPORTER);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.MODERATION_TARGET_INVALID);
      }
    });

    it('reason 不在白名单 → 422 VALIDATION_FAILED（不是 target 的错）', async () => {
      for (const reason of ['自由文本', undefined, '']) {
        const res = await report({ targetType: 'post', targetId: target, reason }, REPORTER);
        expect(res.status).toBe(422);
        expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      }
    });

    it('targetId 缺失 → 422 VALIDATION_FAILED', async () => {
      const res = await report({ targetType: 'post', reason: 'spam' }, REPORTER);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('入参不合法的那些请求一条流水都没写', async () => {
      expect(await auditLog.listByTarget('post', target)).toEqual([]);
      expect(await statusOf(target)).toBe('approved');
    });
  });
});
