import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import {
  FOLLOW_REPOSITORY,
  InMemoryFollowRepository,
  PostgresFollowRepository,
} from './follow.repository';

/**
 * 只提供 FOLLOW_REPOSITORY。
 *
 * 抽出来的理由同 `PetRepositoryModule` / `PostRepositoryModule`：无库模式的关注流
 * 要在动态仓储里问一句「这个人关注了哪些宠物」，而 `FollowsModule` 还带着
 * `FollowsService`（它依赖宠物仓储做卡片投影）。让动态域去 import 整个关注域，
 * 等于把宠物卡的投影逻辑拖进自己的依赖里。
 *
 * **不能各建一个工厂**：那等于两份内存关注关系 —— 端点关注写进这一份，
 * feed 读的是那一份，无库模式下 feed 会恒为空。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: FOLLOW_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresFollowRepository(pool) : new InMemoryFollowRepository(),
      inject: [PG_POOL],
    },
  ],
  exports: [FOLLOW_REPOSITORY],
})
export class FollowRepositoryModule {}
