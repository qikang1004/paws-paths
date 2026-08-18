import { ERROR_CODES } from '@paws/types';
import { AccessTokenService } from '../src/wechat/access-token.service';
import type { TokenStore } from '../src/wechat/token-store';

const TOKEN_KEY = 'wx:access_token';
const LOCK_KEY = 'wx:access_token:lock';

class FakeTokenStore implements TokenStore {
  private values = new Map<string, string>();
  private locks = new Set<string>();
  readonly ttls: Record<string, number> = {};

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, value);
    this.ttls[key] = ttlSeconds;
  }

  async acquireLock(key: string, _ttlSeconds: number): Promise<boolean> {
    if (this.locks.has(key)) return false;
    this.locks.add(key);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

class FakeWechatApi {
  calls = 0;

  async fetchAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { access_token: `token-${this.calls}`, expires_in: 7200 };
  }
}

describe('AccessTokenService', () => {
  let store: FakeTokenStore;
  let api: FakeWechatApi;
  let svc: AccessTokenService;

  beforeEach(() => {
    store = new FakeTokenStore();
    api = new FakeWechatApi();
    svc = new AccessTokenService(store, api, { retryDelayMs: 5, maxRetries: 20 });
  });

  it('does not call the WeChat API on a cache hit', async () => {
    await store.setWithTtl(TOKEN_KEY, 'cached', 100);

    expect(await svc.get()).toBe('cached');
    expect(api.calls).toBe(0);
  });

  it('caches a cache miss for expires_in minus the safety margin', async () => {
    expect(await svc.get()).toBe('token-1');
    expect(store.ttls[TOKEN_KEY]).toBe(6900);
  });

  it('makes one WeChat API call for five concurrent instances and returns one token', async () => {
    const instances = Array.from(
      { length: 5 },
      () => new AccessTokenService(store, api, { retryDelayMs: 5, maxRetries: 20 }),
    );
    const results = await Promise.all(instances.map((instance) => instance.get()));

    expect(api.calls).toBe(1);
    expect(new Set(results).size).toBe(1);
  });

  it('rechecks the cache after acquiring the lock', async () => {
    const sneaky = new FakeTokenStore();
    const originalAcquireLock = sneaky.acquireLock.bind(sneaky);
    sneaky.acquireLock = async (key: string, ttlSeconds: number) => {
      const acquired = await originalAcquireLock(key, ttlSeconds);
      if (acquired) await sneaky.setWithTtl(TOKEN_KEY, 'filled-by-peer', 100);
      return acquired;
    };
    const peerAware = new AccessTokenService(sneaky, api, { retryDelayMs: 1, maxRetries: 3 });

    expect(await peerAware.get()).toBe('filled-by-peer');
    expect(api.calls).toBe(0);
  });

  it('throws an upstream error instead of waiting forever when the lock remains held', async () => {
    await store.acquireLock(LOCK_KEY, 10);
    const impatient = new AccessTokenService(store, api, { retryDelayMs: 1, maxRetries: 3 });

    await expect(impatient.get()).rejects.toMatchObject({
      code: ERROR_CODES.UPSTREAM_WECHAT,
    });
    expect(api.calls).toBe(0);
  });
});
