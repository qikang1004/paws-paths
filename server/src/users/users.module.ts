import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import {
  InMemoryUserRepository,
  PostgresUserRepository,
  USER_REPOSITORY,
} from './user.repository';
import { UsersService } from './users.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    UsersService,
    {
      provide: USER_REPOSITORY,
      // 有库就落库：favorites.user_id 的外键要求用户真实存在。
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresUserRepository(pool) : new InMemoryUserRepository(),
      inject: [PG_POOL],
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
