import { Module } from '@nestjs/common';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { RATE_LIMIT_OPTIONS, RateLimiterService } from './rate-limit.service';
import { RATE_LIMIT_STORE, RedisRateLimitStore } from './rate-limit.store';
import { ReportRateLimitGuard } from './report-rate-limit.guard';

/**
 * 两个守卫共用一个 `RateLimiterService` 与一个 store。
 *
 * `RATE_LIMIT_OPTIONS` 里那套（一分钟 30 次）是**登录**的默认值；举报在调用处带
 * 自己的 `REPORT_RATE_LIMIT`（一小时 10 次）。共用单例是有意的 ——
 * 两种限流必须落在同一个 Redis 计数空间里，各造一个 provider 只会多一层配线。
 */
@Module({
  providers: [
    { provide: RATE_LIMIT_STORE, useClass: RedisRateLimitStore },
    {
      provide: RATE_LIMIT_OPTIONS,
      useValue: {
        windowSeconds: Number(process.env.LOGIN_RATE_WINDOW_SECONDS ?? 60),
        maxAttempts: Number(process.env.LOGIN_RATE_MAX_ATTEMPTS ?? 30),
      },
    },
    RateLimiterService,
    LoginRateLimitGuard,
    ReportRateLimitGuard,
  ],
  // 守卫也导出：它是**宿主模块**的 injectable —— `@UseGuards` 写在谁的 controller
  // 上，Nest 就在谁的注入上下文里造实例（Task 5 那次 ModeratorGuard 踩过这个）。
  exports: [RateLimiterService, LoginRateLimitGuard, ReportRateLimitGuard],
})
export class RateLimitModule {}
