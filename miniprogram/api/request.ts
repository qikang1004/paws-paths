import { ERROR_CODES, messageForCode } from '../shared/types/index';
import type { SessionStore } from '../store/session';
import { ApiError } from './errors';
import type { WxAdapter, WxRequestOptions, WxRequestResult } from './wx-promise';

export interface CallOptions {
  method?: WxRequestOptions['method'];
  data?: unknown;
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

/** 页面只允许通过这里发请求：统一注入登录态、401 重放、错误码转中文文案。 */
export class ApiClient {
  constructor(
    private readonly wx: WxAdapter,
    private readonly session: SessionStore,
    private readonly baseUrl: string,
  ) {}

  async call<T>(path: string, opts: CallOptions = {}): Promise<T> {
    let token = this.session.token ?? (await this.session.refresh());
    let res = await this.send<T>(path, opts, token);

    if (this.isUnauthorized(res)) {
      // 只重试一次：token 持续无效时不能打成死循环。
      this.session.clear();
      token = await this.session.refresh();
      res = await this.send<T>(path, opts, token);
    }

    const body = res.data;
    if (body.code !== ERROR_CODES.OK) {
      throw new ApiError(body.code, messageForCode(body.code, body.message));
    }
    return body.data as T;
  }

  private send<T>(
    path: string,
    opts: CallOptions,
    token: string,
  ): Promise<WxRequestResult<Envelope<T>>> {
    return this.wx.request<Envelope<T>>({
      url: `${this.baseUrl}${path}`,
      method: opts.method ?? 'GET',
      data: opts.data,
      header: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
  }

  private isUnauthorized(res: WxRequestResult<Envelope<unknown>>): boolean {
    return res.statusCode === 401 || res.data?.code === ERROR_CODES.UNAUTHORIZED;
  }
}
