import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import { PetRepositoryModule } from '../pets/pet-repository.module';
import {
  FOLLOW_REPOSITORY,
  InMemoryFollowRepository,
  PostgresFollowRepository,
} from './follow.repository';
import { FollowsService } from './follows.service';

/**
 * 关注域。刻意不带 controller：
 * - `POST/DELETE /pets/:id/follow` 挂在 PetsController 上（路径归宠物资源）
 * - `GET /me/following` 挂在 MeController 上（路径归当前用户）
 */
@Module({
  imports: [AuthModule, DatabaseModule, PetRepositoryModule],
  providers: [
    {
      provide: FOLLOW_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresFollowRepository(pool) : new InMemoryFollowRepository(),
      inject: [PG_POOL],
    },
    FollowsService,
  ],
  exports: [FollowsService],
})
export class FollowsModule {}
