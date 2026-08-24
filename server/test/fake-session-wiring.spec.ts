import { Test } from '@nestjs/testing';
import { FakeWechatSessionApi } from '../src/wechat/fake-session.service';
import { WechatApiService, WECHAT_SESSION_API } from '../src/wechat/wechat-api.service';
import { WechatModule } from '../src/wechat/wechat.module';

/** 开关要真的换掉注入的实现，否则等于没接上。 */
describe('WechatModule 的假会话开关', () => {
  const saved = process.env.FAKE_WECHAT_LOGIN;

  afterEach(() => {
    if (saved === undefined) delete process.env.FAKE_WECHAT_LOGIN;
    else process.env.FAKE_WECHAT_LOGIN = saved;
  });

  async function sessionImpl(): Promise<unknown> {
    const app = await Test.createTestingModule({ imports: [WechatModule] }).compile();
    const impl = app.get(WECHAT_SESSION_API);
    await app.close();
    return impl;
  }

  it('默认（未设开关）注入真实的微信实现', async () => {
    delete process.env.FAKE_WECHAT_LOGIN;
    expect(await sessionImpl()).toBeInstanceOf(WechatApiService);
  });

  it('FAKE_WECHAT_LOGIN=1 时注入假实现', async () => {
    process.env.FAKE_WECHAT_LOGIN = '1';
    expect(await sessionImpl()).toBeInstanceOf(FakeWechatSessionApi);
  });

  it('值不是 1 时仍用真实现', async () => {
    process.env.FAKE_WECHAT_LOGIN = 'true';
    expect(await sessionImpl()).toBeInstanceOf(WechatApiService);
  });
});
