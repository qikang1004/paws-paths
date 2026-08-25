import { Injectable } from '@nestjs/common';
import type {
  ContentSecurityApi,
  ContentSecurityVerdict,
  ImageCheckInput,
  TextCheckInput,
} from './content-security';

/**
 * 本地联调用的假内容安全：不请求微信，一律落 `pending`。
 *
 * **绝不返回 `approved`**（Global Constraint 17）。这不是保守，是这个开关唯一
 * 可接受的行为：假实现一放行，「未 approved 内容对他人不可见」那条过审必要
 * 条件的安全测试就再也验不到任何过滤路径 —— 它会全绿，却什么都没测。
 *
 * 代价是本地联调时自己发的动态别人看不见。要看见就手工改库里的
 * `audit_status`，或者配好正式 AppID 把这个开关关掉。
 */
@Injectable()
export class FakeContentSecurityApi implements ContentSecurityApi {
  async checkText(_input: TextCheckInput): Promise<ContentSecurityVerdict> {
    return 'pending';
  }

  async checkImage(_input: ImageCheckInput): Promise<ContentSecurityVerdict> {
    return 'pending';
  }
}
