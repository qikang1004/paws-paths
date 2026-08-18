import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { verify } from 'jsonwebtoken';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ApiException } from '../src/common/api.exception';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { WechatApiService } from '../src/wechat/wechat-api.service';

class FakeWechatApi {
  openid = 'openid-aaa';
  fail = false;

  async code2Session(code: string): Promise<{ openid: string; sessionKey: string }> {
    if (this.fail) {
      throw new ApiException(ERROR_CODES.UPSTREAM_WECHAT, undefined, 502);
    }
    return { openid: this.openid, sessionKey: `sk-${code}` };
  }

  async fetchAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    return { access_token: 'at', expires_in: 7200 };
  }
}

describe('POST /auth/wx-login', () => {
  let app: INestApplication;
  const fake = new FakeWechatApi();

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WechatApiService)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fake.fail = false;
    fake.openid = 'openid-aaa';
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
    expect(payload.openid).toBe('openid-aaa');
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
    fake.openid = 'openid-bbb';
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
});
