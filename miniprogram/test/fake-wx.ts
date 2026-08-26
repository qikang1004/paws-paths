import type {
  WxAdapter,
  WxMediaFile,
  WxRequestOptions,
  WxRequestResult,
  WxUploadOptions,
  WxUploadResult,
} from '../api/wx-promise';

export type Responder = (opts: WxRequestOptions) => WxRequestResult<unknown>;
export type UploadResponder = (opts: WxUploadOptions) => WxUploadResult;

export class FakeWx implements WxAdapter {
  loginCalls = 0;
  getLocationCalls = 0;

  /** 设成 Error 就是模拟用户拒绝授权。 */
  locationOutcome: { latitude: number; longitude: number } | Error = {
    latitude: 31.23,
    longitude: 121.47,
  };

  /**
   * `chooseMedia` 的结果。设成 Error 就是模拟用户点了「取消」——
   * wx 的取消也走 fail 回调，与真实的失败无法区分。
   */
  mediaOutcome: WxMediaFile[] | Error = [];
  readonly chooseMediaCalls: number[] = [];

  readonly sent: WxRequestOptions[] = [];

  /**
   * 上传单独排一条队。`SessionStore.doRefresh()` 走的是 `wx.request`，
   * 也就是说刷新令牌会占掉 `sent` 里的一格 —— 两条通道混在一个队列里，
   * 「401 后重试上传」这种用例的下标就得跟着登录请求一起数。
   */
  readonly uploaded: WxUploadOptions[] = [];

  private readonly storage = new Map<string, string>();
  private responders: Responder[] = [];
  private uploadResponders: UploadResponder[] = [];

  /** 按调用顺序排队响应；队列耗尽后重复使用最后一个。 */
  queue(...responders: Responder[]): void {
    this.responders = responders;
  }

  queueUpload(...responders: UploadResponder[]): void {
    this.uploadResponders = responders;
  }

  async login(): Promise<{ code: string }> {
    this.loginCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 3));
    return { code: `wx-code-${this.loginCalls}` };
  }

  async getLocation(): Promise<{ latitude: number; longitude: number }> {
    this.getLocationCalls += 1;
    if (this.locationOutcome instanceof Error) throw this.locationOutcome;
    return this.locationOutcome;
  }

  async chooseMedia(count: number): Promise<WxMediaFile[]> {
    this.chooseMediaCalls.push(count);
    if (this.mediaOutcome instanceof Error) throw this.mediaOutcome;
    return this.mediaOutcome;
  }

  async request<T>(opts: WxRequestOptions): Promise<WxRequestResult<T>> {
    this.sent.push(opts);
    const responder =
      this.responders[this.sent.length - 1] ?? this.responders[this.responders.length - 1];
    if (!responder) throw new Error('FakeWx 没有排队响应');
    return responder(opts) as WxRequestResult<T>;
  }

  async uploadFile(opts: WxUploadOptions): Promise<WxUploadResult> {
    this.uploaded.push(opts);
    const responder =
      this.uploadResponders[this.uploaded.length - 1] ??
      this.uploadResponders[this.uploadResponders.length - 1];
    if (!responder) throw new Error('FakeWx 没有排队上传响应');
    return responder(opts);
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

/** 上传通道的成功响应：信封是**字符串**，和 wx.uploadFile 的真实行为一致。 */
export const okText = <T>(data: T, statusCode = 200): WxUploadResult => ({
  statusCode,
  data: JSON.stringify({ code: 0, message: 'ok', data }),
});
