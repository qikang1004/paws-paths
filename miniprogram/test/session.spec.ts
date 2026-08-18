import { ApiError } from '../api/errors';
import { SessionStore, TOKEN_STORAGE_KEY } from '../store/session';
import { FakeWx, fail, ok } from './fake-wx';

const BASE = 'https://api.example.com';

describe('SessionStore', () => {
  let wx: FakeWx;
  let session: SessionStore;

  beforeEach(() => {
    wx = new FakeWx();
    session = new SessionStore(wx, BASE);
  });

  it('token 从 storage 直接读，不触发 wx.login', () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'stored-token');

    expect(session.token).toBe('stored-token');
    expect(wx.loginCalls).toBe(0);
  });

  it('refresh 成功后把 token 写进 storage', async () => {
    wx.queue(() => ok({ token: 'fresh-token', userId: 'u1', isNewUser: true }, 201));

    expect(await session.refresh()).toBe('fresh-token');
    expect(wx.getStorage(TOKEN_STORAGE_KEY)).toBe('fresh-token');
    expect(wx.sent[0].url).toBe(`${BASE}/auth/wx-login`);
    expect(wx.sent[0].data).toEqual({ code: 'wx-code-1' });
  });

  it('五个并发 refresh 只调一次 wx.login', async () => {
    wx.queue(() => ok({ token: 'once', userId: 'u1', isNewUser: false }, 201));

    const tokens = await Promise.all(Array.from({ length: 5 }, () => session.refresh()));

    expect(wx.loginCalls).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(['once']));
  });

  it('登录接口返回非 0 时抛 ApiError 且不写 storage', async () => {
    wx.queue(() => fail(50201, '微信服务暂时不可用', 502));

    await expect(session.refresh()).rejects.toBeInstanceOf(ApiError);
    expect(wx.getStorage(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('失败后允许再次 refresh，飞行中的 promise 已释放', async () => {
    wx.queue(
      () => fail(50201, '微信服务暂时不可用', 502),
      () => ok({ token: 'second-try', userId: 'u1', isNewUser: false }, 201),
    );

    await expect(session.refresh()).rejects.toBeInstanceOf(ApiError);
    expect(await session.refresh()).toBe('second-try');
    expect(wx.loginCalls).toBe(2);
  });

  it('clear 之后 token 为空', () => {
    wx.setStorage(TOKEN_STORAGE_KEY, 'x');

    session.clear();

    expect(session.token).toBeNull();
  });
});
