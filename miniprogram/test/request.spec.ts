import { ERROR_CODES } from '../shared/types';
import { ApiClient } from '../api/request';
import { SessionStore, TOKEN_STORAGE_KEY } from '../store/session';
import { FakeWx, fail, ok } from './fake-wx';

const BASE = 'https://api.example.com';

describe('ApiClient', () => {
  let wx: FakeWx;
  let client: ApiClient;

  beforeEach(() => {
    wx = new FakeWx();
    client = new ApiClient(wx, new SessionStore(wx, BASE), BASE);
  });

  it('没有 token 时先登录再发业务请求', async () => {
    wx.queue(
      () => ok({ token: 't1', userId: 'u1', isNewUser: true }, 201),
      () => ok({ items: [] }),
    );
    await client.call('/pets');
    expect(wx.loginCalls).toBe(1);
    expect(wx.sent.map((s) => s.url)).toEqual([`${BASE}/auth/wx-login`, `${BASE}/pets`]);
  });

  it('业务请求带 Authorization 头，已有 token 时不再登录', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'existing');
    wx.queue(() => ok({ items: [] }));
    await client.call('/pets');
    expect(wx.loginCalls).toBe(0);
    expect(wx.sent[0].header?.Authorization).toBe('Bearer existing');
  });

  it('POST 请求把 method 与 data 原样带上', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    wx.queue(() => ok({ id: 'p1' }));
    await client.call('/posts', { method: 'POST', data: { content: '今天遛狗' } });
    expect(wx.sent[0].method).toBe('POST');
    expect(wx.sent[0].data).toEqual({ content: '今天遛狗' });
  });

  it('401 时静默重登并重放原请求，调用方无感', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'stale');
    wx.queue(
      () => fail(ERROR_CODES.UNAUTHORIZED, '登录已过期，请重试', 401),
      () => ok({ token: 'renewed', userId: 'u1', isNewUser: false }, 201),
      () => ok({ name: '大黄' }),
    );
    expect(await client.call<{ name: string }>('/pets/1')).toEqual({ name: '大黄' });
    expect(wx.loginCalls).toBe(1);
    expect(wx.sent[2].header?.Authorization).toBe('Bearer renewed');
  });

  it('重放后仍 401 则抛 ApiError，且只重试一次', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'stale');
    wx.queue(
      () => fail(ERROR_CODES.UNAUTHORIZED, '登录已过期，请重试', 401),
      () => ok({ token: 'renewed', userId: 'u1', isNewUser: false }, 201),
      () => fail(ERROR_CODES.UNAUTHORIZED, '登录已过期，请重试', 401),
    );
    await expect(client.call('/pets/1')).rejects.toMatchObject({
      code: ERROR_CODES.UNAUTHORIZED,
    });
    expect(wx.loginCalls).toBe(1);
    expect(wx.sent).toHaveLength(3);
  });

  it('业务错误码抛 ApiError，服务端文案优先', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    wx.queue(() => fail(ERROR_CODES.VALIDATION_FAILED, '犬证编号格式不正确', 422));
    await expect(client.call('/licenses')).rejects.toThrow('犬证编号格式不正确');
  });

  it('服务端没给文案时回落到本地错误码表', async () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    wx.queue(() => fail(ERROR_CODES.RATE_LIMITED, '', 429));
    await expect(client.call('/posts', { method: 'POST' })).rejects.toThrow(
      '操作太频繁，请稍后再试',
    );
  });
});
