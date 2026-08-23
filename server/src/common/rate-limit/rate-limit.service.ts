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

@Injectable()
export class RateLimiterService {
  private readonly opts: RateLimitOptions;

  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Optional() @Inject(RATE_LIMIT_OPTIONS) opts: Partial<RateLimitOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** 超限抛 429 + RATE_LIMITED，由 AllExceptionsFilter 收敛为统一包络。 */
  async check(key: string): Promise<void> {
    const count = await this.store.increment(key, this.opts.windowSeconds);
    if (count > this.opts.maxAttempts) {
      throw new ApiException(
        ERROR_CODES.RATE_LIMITED,
        undefined,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
