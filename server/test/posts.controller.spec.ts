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
import {
  CONTENT_SECURITY_API,
  type ContentSecurityApi,
  type ContentSecurityVerdict,
} from '../src/moderation/content-security';
import { PostsModule } from '../src/posts/posts.module';
import { POST_CONTENT_MAX_LENGTH, PostsService } from '../src/posts/posts.service';
import { UploadsService } from '../src/uploads/uploads.service';

/**
 * 动态：`POST /posts` 发布、`GET /posts?petId=` 列表、`GET /posts/:id` 详情。
 *
 * 两件事贯穿整个套件：
 *
 * 1. **发布返回 `pending`，机审是后台的事。** 发布响应不等内容安全 —— 微信那两个接口
 *    正常也要几百毫秒，慢的时候是几秒，让用户对着转圈等一个「反正结果是待审」的响应
 *    毫无意义。响应里的 `auditStatus` 因此恒为 `pending`，哪怕机审随后就判了通过。
 *    测试要看后续状态时显式 `await posts.settleAuditChecks()` 收敛，不靠 sleep。
 * 2. **未 approved 的内容只有作者看得见**（Global Constraint 16）。这里覆盖列表与详情
 *    两条路径，专项安全测试另见 `post-visibility.security.spec.ts`（门控真库）。
 *
 * 读用例一律打在种子动态上（p-2 / p-5），写用例只打在 p-1 —— 两组互不相扰，
 * 无库模式下也不必在套件之间清理状态。
 */
describe('动态（POST /posts + GET /posts + GET /posts/:id）', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let posts: PostsService;
  let uploads: UploadsService;
  let root: string;

  const DB_URL = process.env.DATABASE_URL;
  let pool: Pool | null = null;

  /** 种子用户：u-1 拥有 p-1（写用例的靶子），u-2 拥有 p-2，u-5 拥有 p-5。 */
  const AUTHOR = 'u-1';
  const OWNER_OF_P2 = 'u-2';
  const OWNER_OF_P5 = 'u-5';

  /** 机审裁决由每个用例自己摆。默认「没结论」，也就是发出去就停在待审。 */
  let verdict: ContentSecurityVerdict = 'pending';
  /** 置 true 时 `checkText` 直接抛，用来验 fail-closed。 */
  let textThrows = false;
  const security: ContentSecurityApi = {
    checkText: async () => {
      if (textThrows) throw new Error('内容安全接口不可用');
      return verdict;
    },
    checkImage: async () => verdict,
  };

  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0x07),
  ]);

  const http = () => request(app.getHttpServer());
  const tokenFor = (sub: string) => sign({ openid: `openid-${sub}` }, 'test-secret', { subject: sub });
  const as = (req: request.Test, sub: string) => req.set('Authorization', `Bearer ${tokenFor(sub)}`);

  /** 发一条动态，返回 supertest 的响应。 */
  const publish = (body: Record<string, unknown>, sub: string = AUTHOR) =>
    as(http().post('/posts'), sub).send(body);

  /** 发一条并断言 201，返回 data。 */
  const publishOk = async (body: Record<string, unknown>) => {
    const res = await publish(body);
    expect(res.status).toBe(201);
    return res.body.data;
  };

  const listOf = async (petId: string, sub?: string, query = '') => {
    const req = http().get(`/posts?petId=${petId}${query}`);
    const res = await (sub ? as(req, sub) : req);
    expect(res.status).toBe(200);
    return res.body.data;
  };

  const idsOf = (data: { items: { id: string }[] }) => data.items.map((item) => item.id);

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    root = mkdtempSync(join(tmpdir(), 'paws-posts-'));
    process.env.UPLOAD_ROOT = root;
    if (DB_URL) pool = new Pool({ connectionString: DB_URL, max: 2 });

    const moduleRef = await Test.createTestingModule({ imports: [PostsModule] })
      .overrideProvider(CONTENT_SECURITY_API)
      .useValue(security)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    posts = moduleRef.get(PostsService);
    uploads = moduleRef.get(UploadsService);
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.UPLOAD_ROOT;
    rmSync(root, { recursive: true, force: true });
    if (pool) {
      // 只删本套件发的（种子动态的 id 形如 po-1，跳过它们），免得攒到下一轮。
      await pool.query(`DELETE FROM posts WHERE author_id = $1 AND id !~ '^po-[0-9]+$'`, [AUTHOR]);
      await pool.end();
    }
  });

  beforeEach(() => {
    verdict = 'pending';
    textThrows = false;
  });

  describe('POST /posts 校验', () => {
    it('未登录 → 401', async () => {
      const res = await http().post('/posts').send({ petId: 'p-1', content: '你好' }).expect(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('空内容 → 422', async () => {
      const res = await publish({ petId: 'p-1', content: '' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('只有空白字符也算空 → 422', async () => {
      const res = await publish({ petId: 'p-1', content: '  \n\t ' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it(`内容超 ${POST_CONTENT_MAX_LENGTH} 字 → 422`, async () => {
      const res = await publish({ petId: 'p-1', content: '喵'.repeat(POST_CONTENT_MAX_LENGTH + 1) });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('长度按码点数，不按 UTF-16 —— 上限个 emoji 应当放行', async () => {
      const data = await publishOk({ petId: 'p-1', content: '🐶'.repeat(POST_CONTENT_MAX_LENGTH) });
      expect([...data.content].length).toBe(POST_CONTENT_MAX_LENGTH);
    });

    it('宠物不存在 → 404', async () => {
      const res = await publish({ petId: 'p-nope', content: '你好' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('替别人的宠物发 → 403', async () => {
      const res = await publish({ petId: 'p-2', content: '你好' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('图片缺 width / height → 422（Global Constraint 21）', async () => {
      const res = await publish({
        petId: 'p-1',
        content: '你好',
        images: [{ url: '/uploads/u-1/x.jpg', height: 800 }],
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('图片宽高非正整数 → 422', async () => {
      const res = await publish({
        petId: 'p-1',
        content: '你好',
        images: [{ url: '/uploads/u-1/x.jpg', width: 0, height: 800 }],
      });
      expect(res.status).toBe(422);
    });

    it('图片张数超上限 → 422', async () => {
      const one = { url: '/uploads/u-1/x.jpg', width: 100, height: 100 };
      const res = await publish({ petId: 'p-1', content: '你好', images: Array(10).fill(one) });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('POST /posts 机审流转', () => {
    it('发布即返回 pending，即使机审随后判通过', async () => {
      verdict = 'approved';
      const data = await publishOk({ petId: 'p-1', content: '今天带大黄去公园' });
      // 响应不等机审：这一刻状态机还没迁移。
      expect(data.auditStatus).toBe('pending');
      expect(data.rejectReason).toBeNull();
      expect(data.petId).toBe('p-1');
      expect(data.petName).toBe('大黄');
      expect(typeof data.id).toBe('string');
      expect(typeof data.publishedAt).toBe('string');
    });

    it('机审通过 → 收敛后 approved，且对他人可见', async () => {
      verdict = 'approved';
      const created = await publishOk({ petId: 'p-1', content: '晒一晒新窝' });
      await posts.settleAuditChecks();

      const mine = await http().get(`/posts/${created.id}`).expect(200);
      expect(mine.body.data.auditStatus).toBe('approved');
      const others = await as(http().get(`/posts/${created.id}`), OWNER_OF_P2).expect(200);
      expect(others.body.data.id).toBe(created.id);
    });

    it('机审驳回 → rejected + 驳回原因，且他人 404', async () => {
      verdict = 'rejected';
      const created = await publishOk({ petId: 'p-1', content: '这条会被判违规' });
      await posts.settleAuditChecks();

      const mine = await as(http().get(`/posts/${created.id}`), AUTHOR).expect(200);
      expect(mine.body.data.auditStatus).toBe('rejected');
      expect(typeof mine.body.data.rejectReason).toBe('string');
      expect(mine.body.data.rejectReason).not.toBe('');
      await http().get(`/posts/${created.id}`).expect(404);
    });

    it('机审没有结论 → 留在 pending，他人 404', async () => {
      const created = await publishOk({ petId: 'p-1', content: '假实现下就是这条路径' });
      await posts.settleAuditChecks();

      const mine = await as(http().get(`/posts/${created.id}`), AUTHOR).expect(200);
      expect(mine.body.data.auditStatus).toBe('pending');
      await http().get(`/posts/${created.id}`).expect(404);
    });

    it('机审接口抛异常 → fail-closed 留在 pending（Global Constraint 18）', async () => {
      textThrows = true;
      const created = await publishOk({ petId: 'p-1', content: '接口挂了也不能放行' });
      await posts.settleAuditChecks();

      const mine = await as(http().get(`/posts/${created.id}`), AUTHOR).expect(200);
      expect(mine.body.data.auditStatus).toBe('pending');
      await http().get(`/posts/${created.id}`).expect(404);
    });

    it('机审失败不影响发布本身 —— 响应仍是 201', async () => {
      textThrows = true;
      const res = await publish({ petId: 'p-1', content: '异步失败不该冒到响应里' });
      expect(res.status).toBe(201);
      expect(res.body.data.auditStatus).toBe('pending');
      await posts.settleAuditChecks();
    });
  });

  describe('图片的审核状态由服务端定，与动态本身独立', () => {
    /** 用真上传通道造一张图，`verdict` 决定它落哪一档（approved → public，pending → private）。 */
    const upload = async (lane: ContentSecurityVerdict) => {
      verdict = lane;
      // 宽高传字符串：multipart 的字段一律是字符串，`save()` 收的就是那个形状。
      const result = await uploads.save(AUTHOR, { buffer: PNG }, { width: '400', height: '300' });
      return result.url;
    };

    it('文字过审、某张图未过审 → 他人看得到文字，看不到那张图', async () => {
      const publicUrl = await upload('approved');
      const privateUrl = await upload('pending');

      verdict = 'approved';
      // 客户端把两张都报成 approved，服务端一律按图片实际落的档位重判。
      const created = await publishOk({
        petId: 'p-1',
        content: '两张图，一张过审一张待审',
        images: [
          { url: publicUrl, width: 400, height: 300, auditStatus: 'approved' },
          { url: privateUrl, width: 400, height: 300, auditStatus: 'approved' },
        ],
      });
      await posts.settleAuditChecks();

      const mine = await as(http().get(`/posts/${created.id}`), AUTHOR).expect(200);
      expect(mine.body.data.images.map((i: { auditStatus: string }) => i.auditStatus)).toEqual([
        'approved',
        'pending',
      ]);

      const others = await http().get(`/posts/${created.id}`).expect(200);
      expect(others.body.data.content).toBe('两张图，一张过审一张待审');
      expect(others.body.data.images).toHaveLength(1);
      expect(others.body.data.images[0].url).toBe(publicUrl);
      expect(others.body.data.images[0].width).toBe(400);
      expect(others.body.data.images[0].height).toBe(300);
    });

    it('不是本服务发出的图片地址 → 落 pending（验不了就不放行）', async () => {
      verdict = 'approved';
      const created = await publishOk({
        petId: 'p-1',
        content: '外链图',
        images: [{ url: 'https://picsum.photos/seed/x/400/300', width: 400, height: 300 }],
      });
      await posts.settleAuditChecks();

      const mine = await as(http().get(`/posts/${created.id}`), AUTHOR).expect(200);
      expect(mine.body.data.images[0].auditStatus).toBe('pending');
      const others = await http().get(`/posts/${created.id}`).expect(200);
      expect(others.body.data.images).toHaveLength(0);
    });
  });

  describe('GET /posts?petId=', () => {
    it('缺 petId → 422', async () => {
      const res = await http().get('/posts').expect(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('petId 不存在 → 404', async () => {
      const res = await http().get('/posts?petId=p-nope').expect(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('page=0 → 422（沿用列表查询的统一校验）', async () => {
      await http().get('/posts?petId=p-5&page=0').expect(422);
    });

    it('未登录 → 只看得到 approved 的', async () => {
      const data = await listOf('p-5');
      expect(idsOf(data)).toEqual(['po-3']);
      expect(data.page).toBe(1);
      expect(data.hasMore).toBe(false);
    });

    it('作者本人 → 自己的 pending / rejected 也在列表里，按发布时间倒序', async () => {
      const data = await listOf('p-5', OWNER_OF_P5);
      expect(idsOf(data)).toEqual(['po-5', 'po-3']);
      const at = data.items.map((i: { publishedAt: string }) => Date.parse(i.publishedAt));
      expect(at[0]).toBeGreaterThan(at[1]);
      expect(data.items[0].auditStatus).toBe('rejected');
      expect(data.items[0].rejectReason).toBe('包含疑似违规信息');
    });

    it('另一个登录用户 → 看不到别人的未过审动态', async () => {
      expect(idsOf(await listOf('p-5', OWNER_OF_P2))).toEqual(['po-3']);
      expect(idsOf(await listOf('p-2', OWNER_OF_P5))).toEqual(['po-2']);
    });

    it('分页在可见性过滤之后仍然对 —— pageSize=1 翻两页拿到两条', async () => {
      const first = await listOf('p-5', OWNER_OF_P5, '&page=1&pageSize=1');
      expect(idsOf(first)).toEqual(['po-5']);
      expect(first.hasMore).toBe(true);

      const second = await listOf('p-5', OWNER_OF_P5, '&page=2&pageSize=1');
      expect(idsOf(second)).toEqual(['po-3']);
      expect(second.hasMore).toBe(false);
    });

    it('列表项也过滤未过审的图片', async () => {
      const anon = await listOf('p-5');
      expect(anon.items[0].images.map((i: { id: string }) => i.id)).toEqual(['pi-4']);
      const owner = await listOf('p-5', OWNER_OF_P5);
      const po3 = owner.items.find((i: { id: string }) => i.id === 'po-3');
      expect(po3.images.map((i: { id: string }) => i.id)).toEqual(['pi-4', 'pi-6']);
    });
  });

  describe('GET /posts/:id', () => {
    it('approved 的动态所有人可见，图片按 sort_order 排', async () => {
      const res = await http().get('/posts/po-1').expect(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.petId).toBe('p-1');
      expect(res.body.data.petName).toBe('大黄');
      expect(res.body.data.images.map((i: { id: string }) => i.id)).toEqual(['pi-1', 'pi-2']);
      expect(res.body.data.images[0].width).toBeGreaterThan(0);
      expect(res.body.data.images[0].height).toBeGreaterThan(0);
    });

    it('不存在 → 404', async () => {
      const res = await http().get('/posts/po-nope').expect(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    });

    it('别人的 pending 动态 → 未登录 404、其他登录用户 404、作者本人 200', async () => {
      await http().get('/posts/po-4').expect(404);
      await as(http().get('/posts/po-4'), OWNER_OF_P5).expect(404);
      const mine = await as(http().get('/posts/po-4'), OWNER_OF_P2).expect(200);
      expect(mine.body.data.auditStatus).toBe('pending');
    });

    it('别人的 rejected 动态 → 未登录 404，作者本人看得到驳回原因', async () => {
      await http().get('/posts/po-5').expect(404);
      const mine = await as(http().get('/posts/po-5'), OWNER_OF_P5).expect(200);
      expect(mine.body.data.auditStatus).toBe('rejected');
      expect(mine.body.data.rejectReason).toBe('包含疑似违规信息');
    });
  });
});
