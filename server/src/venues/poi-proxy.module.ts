import { Module } from '@nestjs/common';
import { MAP_POI_CLIENT, TencentPoiClient } from './poi-client';
import { POI_CACHE, RedisPoiCache } from './poi-cache';
import { PoiProxyService } from './poi-proxy.service';

/**
 * POI 代理模块。无 TENCENT_MAP_KEY 时 MAP_POI_CLIENT 绑定 null，
 * PoiProxyService.search 直接返回 null → 纯 venue_extras 模式（本机常态）。
 */
@Module({
  providers: [
    {
      provide: MAP_POI_CLIENT,
      useFactory: () => {
        const key = process.env.TENCENT_MAP_KEY;
        return key ? new TencentPoiClient(key) : null;
      },
    },
    { provide: POI_CACHE, useClass: RedisPoiCache },
    PoiProxyService,
  ],
  exports: [PoiProxyService],
})
export class PoiProxyModule {}
