import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import { FOLLOW_REPOSITORY, type FollowRepository } from '../follows/follow.repository';
import { FollowRepositoryModule } from '../follows/follow-repository.module';
import {
  InMemoryPostRepository,
  POST_REPOSITORY,
  PostgresPostRepository,
} from './post.repository';

/**
 * 只提供 POST_REPOSITORY。
 *
 * 单独成模块是为了打断循环（同 `PetRepositoryModule`）：PostsModule 需要
 * ModerationModule 出机审裁决，而 ModerationModule 在无库模式下需要动态仓储
 * 当举报目标源 —— 直接互相 import 就成环了。两边都 import 这个模块，
 * 就不用 forwardRef，也不用把工厂复制两份（复制两份等于两份内存数据，会分叉）。
 *
 * 关注仓储是**无库模式的关注流**要的：内存里没有 JOIN，只能问一句
 * 「这个人关注了哪些宠物」。Postgres 实现不需要它（一条 SQL 里 JOIN follows）。
 */
@Module({
  imports: [DatabaseModule, FollowRepositoryModule],
  providers: [
    {
      provide: POST_REPOSITORY,
      useFactory: (pool: Pool | null, follows: FollowRepository) =>
        pool ? new PostgresPostRepository(pool) : new InMemoryPostRepository(follows),
      inject: [PG_POOL, FOLLOW_REPOSITORY],
    },
  ],
  exports: [POST_REPOSITORY],
})
export class PostRepositoryModule {}
