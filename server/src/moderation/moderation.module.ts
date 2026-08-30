import { Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { RateLimitModule } from '../common/rate-limit/rate-limit.module';
import { PostRepositoryModule } from '../posts/post-repository.module';
import { POST_REPOSITORY, type PostRepository } from '../posts/post.repository';
import { WechatModule } from '../wechat/wechat.module';
import {
  AUDIT_LOG_REPOSITORY,
  InMemoryAuditLogRepository,
  PostgresAuditLogRepository,
  type AuditLogRepository,
} from './audit-log.repository';
import { CONTENT_SECURITY_API, shouldFakeContentSecurity } from './content-security';
import { FakeContentSecurityApi } from './fake-content-security.api';
import {
  InMemoryModerationRepository,
  MODERATION_REPOSITORY,
  PostgresModerationRepository,
  type InMemoryModerationTargetSource,
  type ModerationTarget,
  type ModerationTargetRef,
} from './moderation.repository';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ReportsController } from './reports.controller';
import { WechatContentSecurityApi } from './wechat-content-security.api';

/**
 * 内容安全的真假实现二选一。与 `WechatModule` 的假会话开关同一套写法：
 * 用工厂而不是在装饰器里判断 —— 装饰器在模块被 import 时就求值了，
 * 那时环境变量可能还没注入。
 *
 * 开着假实现等于所有 UGC 都停在 `pending`（不是放行，见 Global Constraint 17），
 * 但也意味着**没有任何内容会自动过审**，所以解析时打一条醒目的警告。
 */
const contentSecurityProvider = {
  provide: CONTENT_SECURITY_API,
  inject: [WechatContentSecurityApi, FakeContentSecurityApi],
  useFactory: (real: WechatContentSecurityApi, fake: FakeContentSecurityApi) => {
    if (!shouldFakeContentSecurity(process.env.FAKE_CONTENT_SECURITY)) return real;
    new Logger('ModerationModule').warn(
      'FAKE_CONTENT_SECURITY=1：内容安全检查已被假实现替代，所有 UGC 一律停在待审、' +
        '不会自动过审（刻意不放行）。仅限本地联调，提审前必须关掉并用正式 AppID 真跑一次。',
    );
    return fake;
  },
};

/** 双绑定：有库走 Postgres，无库走内存（与 FOLLOW_REPOSITORY 同款工厂）。 */
const auditLogProvider = {
  provide: AUDIT_LOG_REPOSITORY,
  useFactory: (pool: Pool | null) =>
    pool ? new PostgresAuditLogRepository(pool) : new InMemoryAuditLogRepository(),
  inject: [PG_POOL],
};

/**
 * 无库模式下「举报目标在哪」的适配器。
 *
 * 状态与作者都从**动态仓储**读、也写回它，不在审核域另存一份：两个内存仓储各存
 * 一半会立刻分叉（举报改了这边的状态，而 `GET /posts` 读的是那边的），
 * 「举报后内容对他人不可见」这条断言就会在无库模式下假绿。
 *
 * 图片的作者取所属动态的 —— `PostImageRow` 上没有作者，与 Postgres 侧那条
 * JOIN 到 `posts` 的 SQL 同源。
 */
class PostTargetSource implements InMemoryModerationTargetSource {
  constructor(private readonly posts: PostRepository) {}

  async findTarget(ref: ModerationTargetRef): Promise<ModerationTarget | null> {
    if (ref.targetType === 'post') {
      const row = await this.posts.getById(ref.targetId);
      if (!row) return null;
      return { ...ref, status: row.auditStatus, authorId: row.authorId };
    }
    const found = await this.posts.findImageById(ref.targetId);
    if (!found) return null;
    return { ...ref, status: found.image.auditStatus, authorId: found.post.authorId };
  }

  async setStatus(
    ref: ModerationTargetRef,
    status: AuditStatusOf,
    rejectReason: string | null,
  ): Promise<void> {
    if (ref.targetType === 'post') {
      await this.posts.setAuditStatus(ref.targetId, status, rejectReason);
      return;
    }
    // 图片没有 `reject_reason` 那一列 —— 驳回原因挂在动态上，Postgres 侧同理。
    await this.posts.setImageAuditStatus(ref.targetId, status);
  }

  /**
   * 工单列表要的内容原文。
   *
   * `authorNickname` 在无库模式下**回退成作者 id**：内存用户仓储按 openid 存，
   * 而种子动态的 `authorId`（`u-1` 等）在那里压根没有对应记录。把用户仓储注进来
   * 换一个昵称不值那个耦合 —— 无库是演示降级，运营界面在真库上跑。
   */
  async describe(ref: ModerationTargetRef): Promise<{
    content: string;
    imageUrls: string[];
    authorNickname: string;
  } | null> {
    if (ref.targetType === 'post') {
      const row = await this.posts.getById(ref.targetId);
      if (!row) return null;
      return {
        content: row.content,
        imageUrls: row.images.map((image) => image.url),
        authorNickname: row.authorId,
      };
    }
    const found = await this.posts.findImageById(ref.targetId);
    if (!found) return null;
    // 举报指向的是这一张图，不是整条动态 —— 只给这张。
    return {
      content: found.post.content,
      imageUrls: [found.image.url],
      authorNickname: found.post.authorId,
    };
  }
}

/** 只为上面那个类的签名取个短名，避免再引一次 @paws/types 的类型。 */
type AuditStatusOf = Parameters<PostRepository['setAuditStatus']>[1];

/**
 * 双绑定：有库走 Postgres 的单条 CTE，无库走内存三步。
 *
 * 内存实现要吃动态仓储与流水仓储两个依赖 —— 它得把状态改在动态仓储那份数据上
 * （见 `PostTargetSource` 的注释），而流水要与状态迁移一起写。
 */
const moderationRepositoryProvider = {
  provide: MODERATION_REPOSITORY,
  useFactory: (pool: Pool | null, posts: PostRepository, auditLog: AuditLogRepository) =>
    pool
      ? new PostgresModerationRepository(pool)
      : new InMemoryModerationRepository(new PostTargetSource(posts), auditLog),
  inject: [PG_POOL, POST_REPOSITORY, AUDIT_LOG_REPOSITORY],
};

@Module({
  // PostRepositoryModule 只为无库模式的目标源借一个 POST_REPOSITORY。
  // 单独成模块是为了打断循环：PostsModule 需要 ModerationModule 出机审裁决，
  // 而这里需要动态仓储 —— 直接 import PostsModule 就成环了。
  //
  // RateLimitModule 出 ReportRateLimitGuard：举报每成功一次内容就立刻隐藏，
  // 不限流等于给每个账号一个批量下架按钮。守卫是宿主模块的 injectable，
  // 所以要 import 才造得出来（同 ModeratorGuard 那次的教训）。
  imports: [WechatModule, DatabaseModule, AuthModule, RateLimitModule, PostRepositoryModule],
  controllers: [ReportsController, ModerationController],
  providers: [
    WechatContentSecurityApi,
    FakeContentSecurityApi,
    contentSecurityProvider,
    auditLogProvider,
    moderationRepositoryProvider,
    ModerationService,
  ],
  // 只吐令牌，不吐两个实现本体：业务代码因此拿不到「绕开开关直接调真微信」的路径。
  // 审计流水同理 —— 拿到的是接口，接口上没有 update/delete。
  exports: [CONTENT_SECURITY_API, AUDIT_LOG_REPOSITORY, MODERATION_REPOSITORY],
})
export class ModerationModule {}
