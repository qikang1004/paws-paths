import { Logger, Module } from '@nestjs/common';
import { AccessTokenService, WECHAT_TOKEN_FETCHER } from './access-token.service';
import { FakeWechatSessionApi, shouldFakeWechatLogin } from './fake-session.service';
import { RedisTokenStore, TOKEN_STORE } from './token-store';
import { WechatApiService, WECHAT_SESSION_API } from './wechat-api.service';

/**
 * 本地联调时用假会话替代真微信登录：本地没有正式 AppID，
 * 开发者工具的 code 也只对特定 AppID 有效，真登录走不通。
 *
 * 用工厂而不是在装饰器里直接判断：装饰器在模块被 import 时就求值了，
 * 那时环境变量可能还没注入。工厂延后到容器解析时才读。
 *
 * 开着它等于谁都能登录成任意用户，所以解析时打一条醒目的警告日志，
 * 别让它在部署环境里静悄悄地开着。
 */
const sessionApiProvider = {
  provide: WECHAT_SESSION_API,
  inject: [WechatApiService, FakeWechatSessionApi],
  useFactory: (real: WechatApiService, fake: FakeWechatSessionApi) => {
    if (!shouldFakeWechatLogin(process.env.FAKE_WECHAT_LOGIN)) return real;
    new Logger('WechatModule').warn(
      'FAKE_WECHAT_LOGIN=1：微信登录已被假实现替代，任何 code 都能换到 openid。仅限本地联调，切勿用于部署环境。',
    );
    return fake;
  },
};

@Module({
  providers: [
    WechatApiService,
    FakeWechatSessionApi,
    { provide: TOKEN_STORE, useClass: RedisTokenStore },
    { provide: WECHAT_TOKEN_FETCHER, useExisting: WechatApiService },
    sessionApiProvider,
    AccessTokenService,
  ],
  // 只吐出 AccessTokenService（Redis 单点缓存出口）与收窄的会话接口。
  // 不 export WechatApiService 本体：业务代码因此注入不到 fetchAccessToken，
  // 无法绕过缓存与分布式锁直接拉微信 access_token。
  exports: [AccessTokenService, WECHAT_SESSION_API],
})
export class WechatModule {}
