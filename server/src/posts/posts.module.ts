import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ModerationModule } from '../moderation/moderation.module';
import { PetRepositoryModule } from '../pets/pet-repository.module';
import { UploadsModule } from '../uploads/uploads.module';
import { PostRepositoryModule } from './post-repository.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

/**
 * 动态域。五个依赖各有其用：`PostRepositoryModule` 出动态仓储本体，
 * `PetRepositoryModule` 定归属与宠物名，`ModerationModule` 出机审裁决，
 * `UploadsModule` 反查图片落在哪一档，`AuthModule` 提供两个守卫。
 *
 * 仓储的工厂搬去 `PostRepositoryModule` 了：`ModerationModule` 在无库模式下
 * 也要拿动态仓储当举报目标源，两处各建一个工厂等于两份内存数据 ——
 * 举报改了这边的状态，`GET /posts` 读的是那边的，实测就是这么分叉的。
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PostRepositoryModule,
    PetRepositoryModule,
    ModerationModule,
    UploadsModule,
  ],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
