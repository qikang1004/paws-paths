import { mkdtempSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import {
  CONTENT_SECURITY_API,
  type ContentSecurityApi,
  type ContentSecurityVerdict,
} from '../src/moderation/content-security';
import { MAX_UPLOAD_BYTES, sniffImageType } from '../src/uploads/image-file';
import { UploadsModule } from '../src/uploads/uploads.module';

/**
 * 图片上传通道。两个端点一体两面：`POST /uploads` 落盘，`GET /uploads/:owner/:name` 取回。
 *
 * 取回**必须**是控制器路由而不是静态目录：计划 Task 11 的验收要求「未过审图片的 URL
 * 对他人返回 404 而非直接可访问」，而静态中间件没有请求者身份，做不到这件事。
 *
 * 审核状态不落库，由文件所在的那一档（public / private）表示 —— 无库模式下上传也要能用，
 * 加一张表就得连带加一个内存仓储孪生体。详见 phase2-notes 的偏差记录。
 */
describe('图片上传（POST /uploads + GET /uploads/:owner/:name）', () => {
  let app: INestApplication;
  let root: string;

  /** 作者与「别人」：uploads 不碰库，两个 id 只要是合法 token 的 subject 即可。 */
  const ME = 'u-uploader';
  const OTHER = 'u-onlooker';

  /** 内容安全的裁决由每个用例自己摆，默认走假实现那档（pending）。 */
  let verdict: ContentSecurityVerdict = 'pending';
  const checked: Buffer[] = [];
  const security: ContentSecurityApi = {
    checkText: async () => verdict,
    checkImage: async ({ data }) => {
      checked.push(data);
      return verdict;
    },
  };

  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0x07),
  ]);

  const http = () => request(app.getHttpServer());
  const tokenFor = (sub: string) => sign({ openid: `openid-${sub}` }, 'test-secret', { subject: sub });
  const asMe = (req: request.Test) => req.set('Authorization', `Bearer ${tokenFor(ME)}`);
  const asOther = (req: request.Test) => req.set('Authorization', `Bearer ${tokenFor(OTHER)}`);

  /** 一次成功上传，返回响应里的 data。 */
  const upload = async (
    file: Buffer = PNG,
    fields: Record<string, string> = { width: '600', height: '800' },
    filename = 'cat.png',
  ) => {
    let req = asMe(http().post('/uploads'));
    for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
    return req.attach('file', file, { filename });
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    root = mkdtempSync(join(tmpdir(), 'paws-uploads-'));
    process.env.UPLOAD_ROOT = root;

    // 真实现要 access_token，测试里换成可控裁决的替身：三种裁决各自的分支都要走到，
    // 只靠 FAKE_CONTENT_SECURITY 的话永远只能验 pending 那一条。
    const moduleRef = await Test.createTestingModule({ imports: [UploadsModule] })
      .overrideProvider(CONTENT_SECURITY_API)
      .useValue(security)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.UPLOAD_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    verdict = 'pending';
    checked.length = 0;
  });

  describe('图片类型按内容嗅探，不听客户端报的 MIME', () => {
    it.each([
      ['jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
      ['png', PNG],
      ['gif', Buffer.from('GIF89a....')],
      ['webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])],
    ])('认得 %s', (ext, data) => {
      expect(sniffImageType(data)).toBe(ext);
    });

    it.each([
      ['纯文本', Buffer.from('<html>not an image</html>')],
      ['空文件', Buffer.alloc(0)],
      ['只有一半魔数', Buffer.from([0xff, 0xd8])],
      ['RIFF 但不是 WEBP', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')])],
    ])('不认 %s', (_label, data) => {
      expect(sniffImageType(data)).toBeNull();
    });
  });

  it('未登录 401', async () => {
    const res = await http()
      .post('/uploads')
      .field('width', '600')
      .field('height', '800')
      .attach('file', PNG, { filename: 'cat.png' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });

  // Global Constraint 21：width/height 是瀑布流的预估高度，缺了会跳版，所以非可选。
  it.each([
    ['缺 width', { height: '800' }],
    ['缺 height', { width: '600' }],
    ['两个都缺', {}],
    ['width 是 0', { width: '0', height: '800' }],
    ['height 是负数', { width: '600', height: '-1' }],
    ['width 不是整数', { width: '600.5', height: '800' }],
    ['width 不是数字', { width: 'wide', height: '800' }],
  ])('%s 一律 422（Global Constraint 21）', async (_label, fields) => {
    const res = await upload(PNG, fields);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('没带文件 422', async () => {
    const res = await asMe(http().post('/uploads')).field('width', '600').field('height', '800');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('不是图片 422 —— 哪怕文件名和 Content-Type 都装成 jpg', async () => {
    const res = await asMe(http().post('/uploads'))
      .field('width', '600')
      .field('height', '800')
      .attach('file', Buffer.from('#!/bin/sh\nrm -rf /\n'), {
        filename: 'trojan.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('超过尺寸上限 422', async () => {
    const tooBig = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES, 0x07)]);
    const res = await upload(tooBig);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('成功返回 key 与可访问 URL，并把原始字节交给了内容安全', async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(ERROR_CODES.OK);
    expect(res.body.data).toEqual({
      key: expect.stringMatching(new RegExp(`^${ME}/[0-9a-f-]{36}\\.png$`)),
      url: expect.any(String),
      width: 600,
      height: 800,
      auditStatus: 'pending',
    });
    // URL 是相对路径：存的是 key 的位置而不是主机名，换域名不用洗库
    // （阶段 4 换对象存储时会变成绝对 URL，客户端两种都要能认）。
    expect(res.body.data.url).toBe(`/uploads/${res.body.data.key}`);
    expect(checked).toHaveLength(1);
    expect(checked[0].equals(PNG)).toBe(true);
  });

  it('机审通过的图片进公开档，谁都能取', async () => {
    verdict = 'approved';
    const { body } = await upload();
    expect(body.data.auditStatus).toBe('approved');

    for (const get of [
      () => http().get(body.data.url),
      () => asMe(http().get(body.data.url)),
      () => asOther(http().get(body.data.url)),
    ]) {
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(Buffer.from(res.body).equals(PNG)).toBe(true);
    }
  });

  it('未过审的图片只有作者本人取得到，他人与未登录都是 404', async () => {
    const { body } = await upload();
    expect(body.data.auditStatus).toBe('pending');

    const mine = await asMe(http().get(body.data.url));
    expect(mine.status).toBe(200);
    expect(Buffer.from(mine.body).equals(PNG)).toBe(true);

    for (const get of [() => http().get(body.data.url), () => asOther(http().get(body.data.url))]) {
      const res = await get();
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
    }
  });

  it('待审图片不许被中间层缓存，公开图片则长缓存', async () => {
    const pending = await upload();
    const mine = await asMe(http().get(pending.body.data.url));
    // 少了这行，CDN 或反向代理会把作者自己看到的待审图缓存下来发给别人 ——
    // 上面那条「他人 404」的断言就绕过去了。
    expect(mine.headers['cache-control']).toContain('no-store');

    verdict = 'approved';
    const open = await upload();
    const anyone = await http().get(open.body.data.url);
    expect(anyone.headers['cache-control']).toContain('max-age=');
  });

  it('机审判定违规的图片直接 422，且一个字节都不落盘', async () => {
    verdict = 'rejected';
    const tree = async () => (await readdir(root, { recursive: true })).sort();
    const before = await tree();
    const res = await upload();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.AUDIT_REJECTED);
    expect(await tree()).toEqual(before);
  });

  it('取不存在的 key 是 404', async () => {
    const res = await asMe(http().get(`/uploads/${ME}/00000000-0000-4000-8000-000000000000.png`));
    expect(res.status).toBe(404);
  });

  it.each([
    ['穿越到仓库外', `/uploads/${ME}/..%2f..%2f..%2fpackage.json`],
    ['key 里带路径分隔符', `/uploads/${ME}/nested%2fdeep.png`],
    ['非法扩展名', `/uploads/${ME}/00000000-0000-4000-8000-000000000000.sh`],
    ['owner 段带点', `/uploads/..%2E/00000000-0000-4000-8000-000000000000.png`],
  ])('%s 一律 404，不进文件系统', async (_label, url) => {
    const res = await asMe(http().get(url));
    expect(res.status).toBe(404);
  });
});
