import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { TOKEN_STORE, type TokenStore } from './token-store';

const TOKEN_KEY = 'wx:access_token';
const LOCK_KEY = 'wx:access_token:lock';

export interface AccessTokenFetcher {
  fetchAccessToken(): Promise<{ access_token: string; expires_in: number }>;
}

export const WECHAT_TOKEN_FETCHER = 'AccessTokenFetcher';
export const ACCESS_TOKEN_OPTIONS = 'AccessTokenOptions';

export interface AccessTokenOptions {
  safetyMarginSeconds: number;
  lockTtlSeconds: number;
  retryDelayMs: number;
  maxRetries: number;
}

const DEFAULTS: AccessTokenOptions = {
  safetyMarginSeconds: 300,
  lockTtlSeconds: 10,
  retryDelayMs: 200,
  maxRetries: 10,
};

@Injectable()
export class AccessTokenService {
  private readonly opts: AccessTokenOptions;

  constructor(
    @Inject(TOKEN_STORE) private readonly store: TokenStore,
    @Inject(WECHAT_TOKEN_FETCHER) private readonly api: AccessTokenFetcher,
    @Optional() @Inject(ACCESS_TOKEN_OPTIONS) opts: Partial<AccessTokenOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** The sole application entry point for retrieving WeChat access tokens. */
  async get(): Promise<string> {
    const cached = await this.store.get(TOKEN_KEY);
    if (cached) return cached;

    for (let attempt = 0; attempt < this.opts.maxRetries; attempt += 1) {
      const ownerToken = await this.store.acquireLock(LOCK_KEY, this.opts.lockTtlSeconds);
      if (ownerToken) {
        try {
          const filled = await this.store.get(TOKEN_KEY);
          if (filled) return filled;

          const fresh = await this.api.fetchAccessToken();
          const ttlSeconds = fresh.expires_in - this.opts.safetyMarginSeconds;
          if (ttlSeconds <= 0) {
            throw new ApiException(ERROR_CODES.UPSTREAM_WECHAT, undefined, HttpStatus.BAD_GATEWAY);
          }

          await this.store.setWithTtl(TOKEN_KEY, fresh.access_token, ttlSeconds);
          return fresh.access_token;
        } finally {
          await this.store.releaseLock(LOCK_KEY, ownerToken);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.opts.retryDelayMs));
      const byPeer = await this.store.get(TOKEN_KEY);
      if (byPeer) return byPeer;
    }

    throw new ApiException(ERROR_CODES.UPSTREAM_WECHAT, undefined, HttpStatus.BAD_GATEWAY);
  }
}
