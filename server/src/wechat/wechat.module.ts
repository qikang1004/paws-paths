import { Module } from '@nestjs/common';
import { AccessTokenService, WECHAT_TOKEN_FETCHER } from './access-token.service';
import { RedisTokenStore, TOKEN_STORE } from './token-store';
import { WechatApiService } from './wechat-api.service';

@Module({
  providers: [
    WechatApiService,
    { provide: TOKEN_STORE, useClass: RedisTokenStore },
    { provide: WECHAT_TOKEN_FETCHER, useExisting: WechatApiService },
    AccessTokenService,
  ],
  exports: [WechatApiService, AccessTokenService],
})
export class WechatModule {}
