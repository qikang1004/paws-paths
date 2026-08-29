import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import type { UserRole } from '@paws/types';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import {
  InMemoryUserRepository,
  PostgresUserRepository,
  USER_REPOSITORY,
  USER_ROLE_SEED,
} from './user.repository';
import { UsersService } from './users.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    UsersService,
    // 无库模式的角色种子。默认空 —— 无库演示里谁也不是运营，
    // 要造一个 moderator 出来是测试的事（overrideProvider 这个令牌）。
    { provide: USER_ROLE_SEED, useValue: {} as Record<string, UserRole> },
    {
      provide: USER_REPOSITORY,
      // 有库就落库：favorites.user_id 的外键要求用户真实存在。
      useFactory: (pool: Pool | null, roles: Record<string, UserRole>) =>
        pool ? new PostgresUserRepository(pool) : new InMemoryUserRepository(roles),
      inject: [PG_POOL, USER_ROLE_SEED],
    },
  ],
  // USER_REPOSITORY 也导出：ModeratorGuard 要读 users.role，而守卫住在 AuthModule。
  // 导的是令牌不是实现类，拿到的仍然是接口。
  exports: [UsersService, USER_REPOSITORY],
})
export class UsersModule {}
