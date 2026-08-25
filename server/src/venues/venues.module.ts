import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import { HistoryModule } from '../history/history.module';
import {
  FAVORITES_REPOSITORY,
  InMemoryFavoritesRepository,
  PostgresFavoritesRepository,
} from './favorites.repository';
import { PoiProxyModule } from './poi-proxy.module';
import { PoiProxyService } from './poi-proxy.service';
import { VenueRepositoryModule } from './venue-repository.module';
import { VenuesController } from './venues.controller';
import { POI_PROXY, VenuesService } from './venues.service';

@Module({
  imports: [AuthModule, DatabaseModule, PoiProxyModule, VenueRepositoryModule, HistoryModule],
  controllers: [VenuesController],
  providers: [
    {
      provide: FAVORITES_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresFavoritesRepository(pool) : new InMemoryFavoritesRepository(),
      inject: [PG_POOL],
    },
    // PoiProxyModule 负责构造（含无 key 时 client 为 null 的降级）；此处仅取别名 token
    { provide: POI_PROXY, useExisting: PoiProxyService },
    VenuesService,
  ],
  exports: [VenuesService],
})
export class VenuesModule {}
