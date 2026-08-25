import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CONTENT_SECURITY_API } from '../src/moderation/content-security';
import { FakeContentSecurityApi } from '../src/moderation/fake-content-security.api';
import { ModerationModule } from '../src/moderation/moderation.module';
import { WechatContentSecurityApi } from '../src/moderation/wechat-content-security.api';

/**
 * 开关要真的换掉容器里注入的实现，否则等于没接上（同 fake-session-wiring.spec.ts）。
 *
 * 必须用 `useFactory`：`@Module` 装饰器在文件被 import 时就求值了，
 * 那时测试设的环境变量还没生效 —— 阶段 1 在这上面栽过一次。
 */
describe('ModerationModule 的内容安全假实现开关', () => {
  const saved = process.env.FAKE_CONTENT_SECURITY;

  afterEach(() => {
    if (saved === undefined) delete process.env.FAKE_CONTENT_SECURITY;
    else process.env.FAKE_CONTENT_SECURITY = saved;
    jest.restoreAllMocks();
  });

  async function impl(): Promise<unknown> {
    const app = await Test.createTestingModule({ imports: [ModerationModule] }).compile();
    const resolved = app.get(CONTENT_SECURITY_API);
    await app.close();
    return resolved;
  }

  /**
   * 只数**这一条** WARN。`ModerationModule` import 了 `WechatModule`，后者自己有个
   * `FAKE_WECHAT_LOGIN` 的开关也会打 WARN —— 而 `.env` 里那个开关是开着的，
   * 所以 `not.toHaveBeenCalled()` 那种写法在带 env 跑测试时会被邻居的日志顶红。
   * 按开关名筛，两个开关各测各的。
   */
  function warnsAboutThisSwitch(warn: jest.SpyInstance): string[] {
    return warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes('FAKE_CONTENT_SECURITY'));
  }

  it('默认（未设开关）注入真实的微信实现', async () => {
    delete process.env.FAKE_CONTENT_SECURITY;
    expect(await impl()).toBeInstanceOf(WechatContentSecurityApi);
  });

  it('FAKE_CONTENT_SECURITY=1 时注入假实现', async () => {
    process.env.FAKE_CONTENT_SECURITY = '1';
    expect(await impl()).toBeInstanceOf(FakeContentSecurityApi);
  });

  it('值不是 1 时仍用真实现', async () => {
    process.env.FAKE_CONTENT_SECURITY = 'true';
    expect(await impl()).toBeInstanceOf(WechatContentSecurityApi);
  });

  it('假实现生效时打 WARN，别让它在部署环境里静悄悄地开着', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env.FAKE_CONTENT_SECURITY = '1';
    await impl();
    expect(warnsAboutThisSwitch(warn)).toHaveLength(1);
  });

  it('真实现生效时不打这条 WARN', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    delete process.env.FAKE_CONTENT_SECURITY;
    await impl();
    expect(warnsAboutThisSwitch(warn)).toEqual([]);
  });
});
