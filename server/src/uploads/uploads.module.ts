import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { IMAGE_STORAGE } from './image-storage';
import { LocalDiskImageStorage } from './local-disk-image-storage';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/** 默认落在工作目录下的 `var/uploads`（已 gitignore）。部署时用 UPLOAD_ROOT 指到挂载卷。 */
export function uploadRoot(raw: string | undefined): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : join(process.cwd(), 'var', 'uploads');
}

/**
 * 存储同样走 `useFactory` 而不是在装饰器里读 env：装饰器在 import 时求值，
 * 那时测试设的 `UPLOAD_ROOT` 还没生效（同 ModerationModule 的开关）。
 */
const storageProvider = {
  provide: IMAGE_STORAGE,
  useFactory: () => new LocalDiskImageStorage(uploadRoot(process.env.UPLOAD_ROOT)),
};

@Module({
  imports: [ModerationModule],
  controllers: [UploadsController],
  providers: [UploadsService, storageProvider],
  // Task 12 的发布流程要按 key 反查图片落在哪一档，好给 post_images 定审核状态。
  exports: [UploadsService],
})
export class UploadsModule {}
