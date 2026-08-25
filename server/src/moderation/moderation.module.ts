import { Logger, Module } from '@nestjs/common';
import { WechatModule } from '../wechat/wechat.module';
import { CONTENT_SECURITY_API, shouldFakeContentSecurity } from './content-security';
import { FakeContentSecurityApi } from './fake-content-security.api';
import { WechatContentSecurityApi } from './wechat-content-security.api';

/**
 * 内容安全的真假实现二选一。与 `WechatModule` 的假会话开关同一套写法：
 * 用工厂而不是在装饰器里判断 —— 装饰器在模块被 import 时就求值了，
 * 那时环境变量可能还没注入。
 *
 * 开着假实现等于所有 UGC 都停在 `pending`（不是放行，见 Global Constraint 17），
 * 但也意味着**没有任何内容会自动过审**，所以解析时打一条醒目的警告。
 */
const contentSecurityProvider = {
  provide: CONTENT_SECURITY_API,
  inject: [WechatContentSecurityApi, FakeContentSecurityApi],
  useFactory: (real: WechatContentSecurityApi, fake: FakeContentSecurityApi) => {
    if (!shouldFakeContentSecurity(process.env.FAKE_CONTENT_SECURITY)) return real;
    new Logger('ModerationModule').warn(
      'FAKE_CONTENT_SECURITY=1：内容安全检查已被假实现替代，所有 UGC 一律停在待审、' +
        '不会自动过审（刻意不放行）。仅限本地联调，提审前必须关掉并用正式 AppID 真跑一次。',
    );
    return fake;
  },
};

@Module({
  imports: [WechatModule],
  providers: [WechatContentSecurityApi, FakeContentSecurityApi, contentSecurityProvider],
  // 只吐令牌，不吐两个实现本体：业务代码因此拿不到「绕开开关直接调真微信」的路径。
  exports: [CONTENT_SECURITY_API],
})
export class ModerationModule {}
