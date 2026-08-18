import { ERROR_CODES } from '@paws/types';
import { AccessTokenService } from '../src/wechat/access-token.service';
import type { TokenStore } from '../src/wechat/token-store';

const TOKEN_KEY = 'wx:access_token';
const LOCK_KEY = 'wx:access_token:lock';

class FakeTokenStore implements TokenStore {
  private values = new Map<string, string>();
  private locks = new Map<string, string>();
  private nextOwner = 0;
  readonly ttls: Record<string, number> = {};

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, value);
    this.ttls[key] = ttlSeconds;
  }

  async acquireLock(key: string, _ttlSeconds: number): Promise<string | null> {
    if (this.locks.has(key)) return null;

    const ownerToken = `owner-${++this.nextOwner}`;
    this.locks.set(key, ownerToken);
    return ownerToken;
  }

  async releaseLock(key: string, ownerToken: string): Promise<void> {
    if (this.locks.get(key) === ownerToken) this.locks.delete(key);
  }

  expireLock(key: string): void {
    this.locks.delete(key);
  }

  lockOwner(key: string): string | null {
    return this.locks.get(key) ?? null;
  }
}

class FakeWechatApi {
  calls = 0;
  response = { access_token: 'token-1', expires_in: 7200 };

  async fetchAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ...this.response, access_token: `token-${this.calls}` };
  }
}

describe('FakeTokenStore lock ownership', () => {
  it('does not delete a replacement lock when an expired owner releases', async () => {
    const store = new FakeTokenStore();
    const ownerA = await store.acquireLock(LOCK_KEY, 10);
    expect(ownerA).not.toBeNull();

    store.expireLock(LOCK_KEY);
    const ownerB = await store.acquireLock(LOCK_KEY, 10);
    expect(ownerB).not.toBeNull();

    await store.releaseLock(LOCK_KEY, ownerA!);

    expect(store.lockOwner(LOCK_KEY)).toBe(ownerB);
  });
});

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

  it('rejects an expires_in value at or below the safety margin without caching', async () => {
    api.response = { access_token: 'short-lived', expires_in: 300 };

    await expect(svc.get()).rejects.toMatchObject({
      code: ERROR_CODES.UPSTREAM_WECHAT,
    });
    expect(store.ttls[TOKEN_KEY]).toBeUndefined();
    expect(await store.get(TOKEN_KEY)).toBeNull();
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
      const ownerToken = await originalAcquireLock(key, ttlSeconds);
      if (ownerToken) await sneaky.setWithTtl(TOKEN_KEY, 'filled-by-peer', 100);
      return ownerToken;
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
