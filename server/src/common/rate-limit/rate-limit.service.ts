import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../api.exception';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit.store';

export const RATE_LIMIT_OPTIONS = 'RateLimitOptions';

export interface RateLimitOptions {
  windowSeconds: number;
  maxAttempts: number;
}

const DEFAULTS: RateLimitOptions = { windowSeconds: 60, maxAttempts: 30 };

/**
 * 举报限流的窗口与上限：**一小时 10 次**。
 *
 * 与登录那套（一分钟 30 次）刻意不同 —— 两种滥用的时间尺度差一个数量级：
 * 登录重试是分钟级的行为，而正常人一小时举报不了 10 条内容。
 *
 * 为什么举报必须限流：`POST /reports` 每成功一次，那条内容就**立刻对所有人隐藏**
 * （直到运营复核）。不限流等于给每个账号一个批量下架按钮。
 *
 * 具名导出而不是埋在守卫里：这两个数值是契约，测试拿它断言，
 * `RELEASE_CHECKLIST.md` 与 `phase3-notes.md` 里的说明也引用它。
 */
export const REPORT_RATE_LIMIT: RateLimitOptions = { windowSeconds: 3600, maxAttempts: 10 };

/**
 * 运营登录的窗口与上限：**一小时 10 次**。
 *
 * 比小程序登录（一分钟 30 次）严得多，因为这条路径上有**可爆破的凭据** ——
 * 微信登录压根没有密码可猜。而运营账号数量固定、正常人不会一小时试 10 次密码，
 * 所以这个上限对真实使用几乎无感。
 *
 * 与举报限流数值相同但语义无关，各自具名 —— 合并成一个常量会让「改举报的阈值
 * 顺手改了登录的」变成可能。
 */
export const ADMIN_LOGIN_RATE_LIMIT: RateLimitOptions = { windowSeconds: 3600, maxAttempts: 10 };

@Injectable()
export class RateLimiterService {
  private readonly opts: RateLimitOptions;

  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Optional() @Inject(RATE_LIMIT_OPTIONS) opts: Partial<RateLimitOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /**
   * 超限抛 429 + RATE_LIMITED，由 AllExceptionsFilter 收敛为统一包络。
   *
   * `opts` 按次覆盖窗口与上限。加这个参数是为了让举报与登录**共用同一个单例** ——
   * 构造函数里那套默认值是登录的，举报在调用处带自己的数值（`REPORT_RATE_LIMIT`），
   * 不必为第二种限流再造一个 provider（那还得多一个 token，且两处的 store 得是同一个）。
   */
  async check(key: string, opts?: RateLimitOptions): Promise<void> {
    const { windowSeconds, maxAttempts } = opts ?? this.opts;
    const count = await this.store.increment(key, windowSeconds);
    if (count > maxAttempts) {
      throw new ApiException(
        ERROR_CODES.RATE_LIMITED,
        undefined,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
