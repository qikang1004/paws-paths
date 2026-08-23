import { Module } from '@nestjs/common';
import { RATE_LIMIT_OPTIONS, RateLimiterService } from './rate-limit.service';
import { RATE_LIMIT_STORE, RedisRateLimitStore } from './rate-limit.store';

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
  ],
  exports: [RateLimiterService],
})
export class RateLimitModule {}
