import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import { InMemoryPetRepository, PET_REPOSITORY, PostgresPetRepository } from './pet.repository';

/**
 * 只提供 PET_REPOSITORY。
 *
 * 单独成模块是为了打断循环：PetsModule 需要 FollowsService 来标记 isFollowing，
 * FollowsService 又需要 PetRepository 做卡片投影。两个模块都 import 这个，
 * 就不用 forwardRef，也不用把工厂复制两份。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: PET_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresPetRepository(pool) : new InMemoryPetRepository(),
      inject: [PG_POOL],
    },
  ],
  exports: [PET_REPOSITORY],
})
export class PetRepositoryModule {}
