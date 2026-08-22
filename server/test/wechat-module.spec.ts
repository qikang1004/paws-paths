import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessTokenService } from '../src/wechat/access-token.service';
import { WechatApiService, WECHAT_SESSION_API } from '../src/wechat/wechat-api.service';
import { WechatModule } from '../src/wechat/wechat.module';

// access_token 只允许经 Redis 单点缓存获取（AccessTokenService.get()）。
// 若 WechatApiService 整体被 export，业务代码可注入它直接调 fetchAccessToken()
// 绕过缓存与分布式锁——所以模块边界必须只吐出收窄的会话接口。
describe('WechatModule DI 边界', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WechatModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('业务代码注入不到 WechatApiService 本体（fetchAccessToken 不可达）', () => {
    // strict: true 模拟消费方模块的注入解析：只能看到本模块自身与其 export。
    // 默认 strict: false 会在整个容器里翻 provider，测不出模块边界。
    expect(() => app.get(WechatApiService, { strict: true })).toThrow();
  });

  it('AccessTokenService 照常可注入，是 Redis 单点缓存的唯一出口', () => {
    expect(app.get(AccessTokenService)).toBeInstanceOf(AccessTokenService);
  });

  it('WECHAT_SESSION_API 令牌可注入，暴露 code2Session 会话能力', () => {
    const session = app.get(WECHAT_SESSION_API);
    expect(typeof session.code2Session).toBe('function');
  });
});
