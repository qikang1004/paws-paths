import type { WxAdapter, WxRequestOptions, WxRequestResult } from '../api/wx-promise';

export type Responder = (opts: WxRequestOptions) => WxRequestResult<unknown>;

export class FakeWx implements WxAdapter {
  loginCalls = 0;
  readonly sent: WxRequestOptions[] = [];
  private readonly storage = new Map<string, string>();
  private responders: Responder[] = [];

  /** 按调用顺序排队响应；队列耗尽后重复使用最后一个。 */
  queue(...responders: Responder[]): void {
    this.responders = responders;
  }

  async login(): Promise<{ code: string }> {
    this.loginCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 3));
    return { code: `wx-code-${this.loginCalls}` };
  }

  async request<T>(opts: WxRequestOptions): Promise<WxRequestResult<T>> {
    this.sent.push(opts);
    const responder =
      this.responders[this.sent.length - 1] ?? this.responders[this.responders.length - 1];
    if (!responder) throw new Error('FakeWx 没有排队响应');
    return responder(opts) as WxRequestResult<T>;
  }

  getStorage(key: string): string | null {
    return this.storage.get(key) ?? null;
  }

  setStorage(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeStorage(key: string): void {
    this.storage.delete(key);
  }
}

export const ok = <T>(data: T, statusCode = 200): WxRequestResult<unknown> => ({
  statusCode,
  data: { code: 0, message: 'ok', data },
});

export const fail = (
  code: number,
  message: string,
  statusCode: number,
): WxRequestResult<unknown> => ({
  statusCode,
  data: { code, message, data: null },
});
