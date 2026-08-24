import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { verify } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ApiException } from '../src/common/api.exception';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { RATE_LIMIT_STORE } from '../src/common/rate-limit/rate-limit.store';
import { WECHAT_SESSION_API } from '../src/wechat/wechat-api.service';

class FakeWechatApi {
  openid = '';
  fail = false;

  async code2Session(code: string): Promise<{ openid: string; sessionKey: string }> {
    if (this.fail) {
      throw new ApiException(ERROR_CODES.UPSTREAM_WECHAT, undefined, 502);
    }
    return { openid: this.openid, sessionKey: `sk-${code}` };
  }
}

/** 内存限流存储：默认放行（failOpen=true 时计数压在上限内），置 failOpen=false 模拟超限。 */
class FakeRateLimitStore {
  failOpen = true;

  async increment(): Promise<number> {
    return this.failOpen ? 1 : 31;
  }
}

describe('POST /auth/wx-login', () => {
  let app: INestApplication;
  const fake = new FakeWechatApi();
  const rate = new FakeRateLimitStore();

  /**
   * openid 每轮唯一，并在收尾时清库。
   *
   * 设了 DATABASE_URL 时用户会真的落库（UsersModule 按有无连接池选实现），
   * 固定 openid 的话第一轮跑完用户就留在库里，第二轮 isNewUser 就是 false。
   */
  const RUN = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const OPENID_A = `openid-aaa-${RUN}`;
  const OPENID_B = `openid-bbb-${RUN}`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WECHAT_SESSION_API)
      .useValue(fake)
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue(rate)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    // 设了 DATABASE_URL 时上面的登录会真的建用户，跑完清掉，别在库里堆测试数据。
    if (process.env.DATABASE_URL) {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      try {
        await pool.query(`DELETE FROM users WHERE openid = ANY($1::text[])`, [
          [OPENID_A, OPENID_B],
        ]);
      } finally {
        await pool.end();
      }
    }
  });

  beforeEach(() => {
    fake.fail = false;
    fake.openid = OPENID_A;
    rate.failOpen = true;
  });

  it('新 openid 建号并签发可验签的 JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/wx-login')
      .send({ code: 'code-1' })
      .expect(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.isNewUser).toBe(true);
    const payload = verify(res.body.data.token, 'test-secret') as Record<string, unknown>;
    expect(payload.sub).toBe(res.body.data.userId);
    expect(payload.openid).toBe(OPENID_A);
    expect(typeof payload.exp).toBe('number');
  });

  it('同一 openid 二次登录复用同一 userId', async () => {
    const first = await request(app.getHttpServer()).post('/auth/wx-login').send({ code: 'a' });
    const second = await request(app.getHttpServer()).post('/auth/wx-login').send({ code: 'b' });
    expect(second.body.data.userId).toBe(first.body.data.userId);
    expect(second.body.data.isNewUser).toBe(false);
  });

  it('不同 openid 得到不同 userId', async () => {
    const a = await request(app.getHttpServer()).post('/auth/wx-login').send({ code: 'a' });
    fake.openid = OPENID_B;
    const b = await request(app.getHttpServer()).post('/auth/wx-login').send({ code: 'b' });
    expect(b.body.data.userId).not.toBe(a.body.data.userId);
  });

  it('缺 code 时返回 42200', async () => {
    const res = await request(app.getHttpServer()).post('/auth/wx-login').send({}).expect(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('code2Session 失败时收敛为 50201 + 中文文案', async () => {
    fake.fail = true;
    const res = await request(app.getHttpServer())
      .post('/auth/wx-login')
      .send({ code: 'bad' })
      .expect(502);
    expect(res.body.code).toBe(ERROR_CODES.UPSTREAM_WECHAT);
    expect(res.body.message).toBe('微信服务暂时不可用');
  });

  it('超限时返回 429 + RATE_LIMITED，不再放行到业务逻辑', async () => {
    rate.failOpen = false;
    const res = await request(app.getHttpServer())
      .post('/auth/wx-login')
      .send({ code: 'spam' })
      .expect(429);
    expect(res.body.code).toBe(ERROR_CODES.RATE_LIMITED);
  });
});
