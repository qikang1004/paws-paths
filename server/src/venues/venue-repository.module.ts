import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import {
  InMemoryVenueRepository,
  PostgresVenueRepository,
  VENUE_REPOSITORY,
} from './venue.repository';

/**
 * 只提供 VENUE_REPOSITORY（与 PetRepositoryModule 同款）。
 *
 * 单独成模块是为了打断循环：VenuesModule 需要 HistoryService 记浏览历史，
 * HistoryService 又需要 VenueRepository 做卡片投影。两个模块都 import 这个，
 * 就不用 forwardRef，也不用把工厂复制两份。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: VENUE_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresVenueRepository(pool) : new InMemoryVenueRepository(),
      inject: [PG_POOL],
    },
  ],
  exports: [VENUE_REPOSITORY],
})
export class VenueRepositoryModule {}
