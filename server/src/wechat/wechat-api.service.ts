import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import type { AccessTokenFetcher } from './access-token.service';

const BASE = 'https://api.weixin.qq.com';

/** DI 令牌：业务代码只能注入这个窄接口，拿不到 WechatApiService 本体上的 fetchAccessToken。 */
export const WECHAT_SESSION_API = 'WechatSessionApi';

export interface WechatSessionApi {
  code2Session(code: string): Promise<{ openid: string; sessionKey: string }>;
}

@Injectable()
export class WechatApiService implements AccessTokenFetcher, WechatSessionApi {
  private readonly logger = new Logger(WechatApiService.name);

  /** 只允许 AccessTokenService 调用；业务代码一律用 AccessTokenService.get()。 */
  async fetchAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    const body = await this.getJson(
      `${BASE}/cgi-bin/token?grant_type=client_credential` +
        `&appid=${this.env('WX_APPID')}&secret=${this.env('WX_SECRET')}`,
    );
    if (typeof body.access_token !== 'string') throw this.upstream(body);
    return { access_token: body.access_token, expires_in: Number(body.expires_in ?? 7200) };
  }

  async code2Session(code: string): Promise<{ openid: string; sessionKey: string }> {
    const body = await this.getJson(
      `${BASE}/sns/jscode2session?appid=${this.env('WX_APPID')}` +
        `&secret=${this.env('WX_SECRET')}&js_code=${encodeURIComponent(code)}` +
        `&grant_type=authorization_code`,
    );
    if (typeof body.openid !== 'string') throw this.upstream(body);
    return { openid: body.openid, sessionKey: String(body.session_key ?? '') };
  }

  private env(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`缺少环境变量 ${name}`);
    return value;
  }

  private async getJson(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url);
    if (!res.ok) throw this.upstream({ http: res.status });
    return (await res.json()) as Record<string, unknown>;
  }

  /** errcode / errmsg 只进日志，不进响应体。 */
  private upstream(detail: unknown): ApiException {
    this.logger.error(`微信上游返回异常：${JSON.stringify(detail)}`);
    return new ApiException(ERROR_CODES.UPSTREAM_WECHAT, undefined, HttpStatus.BAD_GATEWAY);
  }
}
