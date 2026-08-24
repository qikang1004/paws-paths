import { FakeWechatSessionApi, shouldFakeWechatLogin } from '../src/wechat/fake-session.service';

/**
 * 本地联调用的假会话。
 *
 * 真登录要拿 code 去微信服务器换 openid，本地既没有正式 AppID、
 * 开发者工具的 code 也只对特定 AppID 有效，所以本地根本走不通。
 * 加开关让本地能拿到 openid，但绝不能在生产误开。
 */
describe('shouldFakeWechatLogin', () => {
  it('只有 FAKE_WECHAT_LOGIN=1 才启用', () => {
    expect(shouldFakeWechatLogin('1')).toBe(true);
    expect(shouldFakeWechatLogin('0')).toBe(false);
    expect(shouldFakeWechatLogin('')).toBe(false);
    expect(shouldFakeWechatLogin(undefined)).toBe(false);
  });

  it('true / yes 一律不算开启，避免生产误开绕过登录', () => {
    expect(shouldFakeWechatLogin('true')).toBe(false);
    expect(shouldFakeWechatLogin('yes')).toBe(false);
    expect(shouldFakeWechatLogin('TRUE')).toBe(false);
  });
});

describe('FakeWechatSessionApi', () => {
  it('同一个 code 稳定映射到同一个 openid，便于反复登录拿到同一用户', async () => {
    const api = new FakeWechatSessionApi();
    const a = await api.code2Session('code-abc');
    const b = await api.code2Session('code-abc');
    expect(a.openid).toBe(b.openid);
  });

  it('不同 code 得到不同 openid，方便模拟多个用户', async () => {
    const api = new FakeWechatSessionApi();
    const a = await api.code2Session('code-1');
    const b = await api.code2Session('code-2');
    expect(a.openid).not.toBe(b.openid);
  });

  it('openid 带 fake 前缀，落库后能一眼看出是假数据', async () => {
    const api = new FakeWechatSessionApi();
    const { openid } = await api.code2Session('x');
    expect(openid.startsWith('fake-')).toBe(true);
  });

  it('不发起任何网络请求', async () => {
    const original = globalThis.fetch;
    const spy = jest.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      await new FakeWechatSessionApi().code2Session('x');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
