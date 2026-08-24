import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { WechatSessionApi } from './wechat-api.service';

/**
 * 是否用假会话替代真微信登录。只认字面 '1'。
 *
 * 开着它等于任何 code 都能换到 openid，也就是**谁都能登录成任意用户**。
 * 只能用于本地联调，所以不接受 'true' / 'yes' 这类近义写法——
 * 绕过登录这种事，宁可让人多写一个字符。
 */
export function shouldFakeWechatLogin(raw: string | undefined): boolean {
  return raw === '1';
}

/**
 * 本地联调用的假会话：不请求微信，直接由 code 推出一个稳定的 openid。
 *
 * 用哈希而非随机值，保证同一个 code 每次都映射到同一个用户，
 * 否则每次登录都建新用户，收藏之类的数据会到处散落。
 */
@Injectable()
export class FakeWechatSessionApi implements WechatSessionApi {
  async code2Session(code: string): Promise<{ openid: string; sessionKey: string }> {
    const digest = createHash('sha256').update(code).digest('hex').slice(0, 16);
    // fake- 前缀让落库的假用户一眼可辨，日后要清理也好筛。
    return { openid: `fake-${digest}`, sessionKey: `fake-sk-${digest}` };
  }
}
