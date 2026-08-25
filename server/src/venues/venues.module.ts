import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { FavoritesModule } from '../favorites/favorites.module';
import { HistoryModule } from '../history/history.module';
import { PoiProxyModule } from './poi-proxy.module';
import { PoiProxyService } from './poi-proxy.service';
import { VenueRepositoryModule } from './venue-repository.module';
import { VenuesController } from './venues.controller';
import { POI_PROXY, VenuesService } from './venues.service';

@Module({
  // 收藏仓储由 FavoritesModule 统一提供（阶段 2 迁成多态后它跨域了），
  // 这里不再自己造一份工厂 —— 两份工厂在无库模式下会是两个互不可见的内存实例。
  imports: [
    AuthModule,
    DatabaseModule,
    PoiProxyModule,
    VenueRepositoryModule,
    HistoryModule,
    FavoritesModule,
  ],
  controllers: [VenuesController],
  providers: [
    // PoiProxyModule 负责构造（含无 key 时 client 为 null 的降级）；此处仅取别名 token
    { provide: POI_PROXY, useExisting: PoiProxyService },
    VenuesService,
  ],
  exports: [VenuesService],
})
export class VenuesModule {}
