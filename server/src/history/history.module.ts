import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import { PetRepositoryModule } from '../pets/pet-repository.module';
import { VenueRepositoryModule } from '../venues/venue-repository.module';
import { HistoryService } from './history.service';
import {
  InMemoryViewHistoryRepository,
  PostgresViewHistoryRepository,
  VIEW_HISTORY_REPOSITORY,
} from './view-history.repository';

/**
 * 浏览历史域。刻意不带 controller：
 * - `GET /me/history` 挂在 MeController 上（路径归当前用户）
 * - 写入由 PetsController / VenuesController 的详情端点触发（异步、失败只记日志）
 *
 * 只 import 两个仓储模块而不是 PetsModule / VenuesModule：那两个模块反过来要
 * 依赖本模块记历史，直连就成环了。
 */
@Module({
  imports: [DatabaseModule, PetRepositoryModule, VenueRepositoryModule],
  providers: [
    {
      provide: VIEW_HISTORY_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresViewHistoryRepository(pool) : new InMemoryViewHistoryRepository(),
      inject: [PG_POOL],
    },
    HistoryService,
  ],
  exports: [HistoryService],
})
export class HistoryModule {}
