import { Module } from '@nestjs/common';
import { AccessTokenService, WECHAT_TOKEN_FETCHER } from './access-token.service';
import { RedisTokenStore, TOKEN_STORE } from './token-store';
import { WechatApiService, WECHAT_SESSION_API } from './wechat-api.service';

@Module({
  providers: [
    WechatApiService,
    { provide: TOKEN_STORE, useClass: RedisTokenStore },
    { provide: WECHAT_TOKEN_FETCHER, useExisting: WechatApiService },
    { provide: WECHAT_SESSION_API, useExisting: WechatApiService },
    AccessTokenService,
  ],
  // 只吐出 AccessTokenService（Redis 单点缓存出口）与收窄的会话接口。
  // 不 export WechatApiService 本体：业务代码因此注入不到 fetchAccessToken，
  // 无法绕过缓存与分布式锁直接拉微信 access_token。
  exports: [AccessTokenService, WECHAT_SESSION_API],
})
export class WechatModule {}
