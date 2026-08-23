import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import {
  FAVORITES_REPOSITORY,
  InMemoryFavoritesRepository,
  PostgresFavoritesRepository,
} from './favorites.repository';
import { PoiProxyModule } from './poi-proxy.module';
import { PoiProxyService } from './poi-proxy.service';
import {
  InMemoryVenueRepository,
  PostgresVenueRepository,
  VENUE_REPOSITORY,
} from './venue.repository';
import { VenuesController } from './venues.controller';
import { POI_PROXY, VenuesService } from './venues.service';

@Module({
  imports: [AuthModule, DatabaseModule, PoiProxyModule],
  controllers: [VenuesController],
  providers: [
    {
      provide: VENUE_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresVenueRepository(pool) : new InMemoryVenueRepository(),
      inject: [PG_POOL],
    },
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
