import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import { ModerationModule } from '../moderation/moderation.module';
import { PetRepositoryModule } from '../pets/pet-repository.module';
import { UploadsModule } from '../uploads/uploads.module';
import {
  InMemoryPostRepository,
  POST_REPOSITORY,
  PostgresPostRepository,
} from './post.repository';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

/**
 * 动态域。四个依赖各有其用：`PetRepositoryModule` 定归属与宠物名，
 * `ModerationModule` 出机审裁决，`UploadsModule` 反查图片落在哪一档，
 * `AuthModule` 提供两个守卫。
 */
@Module({
  imports: [AuthModule, DatabaseModule, PetRepositoryModule, ModerationModule, UploadsModule],
  controllers: [PostsController],
  providers: [
    {
      provide: POST_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresPostRepository(pool) : new InMemoryPostRepository(),
      inject: [PG_POOL],
    },
    PostsService,
  ],
  exports: [PostsService],
})
export class PostsModule {}
