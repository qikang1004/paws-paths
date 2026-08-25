import { ERROR_CODES, messageForCode } from '../shared/types/index';
import type { SessionStore } from '../store/session';
import { ApiError } from './errors';
import type {
  WxAdapter,
  WxRequestOptions,
  WxRequestResult,
  WxUploadResult,
} from './wx-promise';

export interface CallOptions {
  method?: WxRequestOptions['method'];
  data?: unknown;
}

/**
 * 上传入参。`formData` 的值必须已经是字符串 —— multipart 通道没有类型，
 * 数字传进去在真机上会被 wx 自己 toString，而服务端只认字符串，
 * 与其两边各自兜一层，不如在这里把类型卡死。
 */
export interface UploadOptions {
  filePath: string;
  name?: string;
  formData?: Record<string, string>;
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
    const res = await this.withFreshToken(
      (token) => this.send<T>(path, opts, token),
      (r) => this.isUnauthorized(r.statusCode, r.data?.code),
    );
    return this.unwrap(res.data);
  }

  /**
   * 图片上传。与 `call` 共用同一套「一次 401 重放」，不是复制一份 ——
   * 两处各写一遍的话，将来改重试策略必然只改到一边。
   *
   * 差别只在信封：`wx.uploadFile` 回的是字符串，得自己解。
   */
  async upload<T>(path: string, opts: UploadOptions): Promise<T> {
    const res = await this.withFreshToken(
      (token) => this.sendUpload(path, opts, token),
      (r) => this.isUnauthorized(r.statusCode, parseEnvelope<T>(r.data)?.code),
    );
    const body = parseEnvelope<T>(res.data);
    // 反向代理返回 HTML 错误页是真会发生的。页面拿到 ApiError 才有中文文案可显示，
    // 拿到 SyntaxError 只能崩在某个 catch 之外。
    if (!body) {
      throw new ApiError(ERROR_CODES.INTERNAL, messageForCode(ERROR_CODES.INTERNAL));
    }
    return this.unwrap(body);
  }

  /** 带上登录态发一次，401 就刷新令牌重发一次 —— 只一次，避免打成死循环。 */
  private async withFreshToken<R>(
    attempt: (token: string) => Promise<R>,
    unauthorized: (res: R) => boolean,
  ): Promise<R> {
    let token = this.session.token ?? (await this.session.refresh());
    let res = await attempt(token);

    if (unauthorized(res)) {
      this.session.clear();
      token = await this.session.refresh();
      res = await attempt(token);
    }
    return res;
  }

  private unwrap<T>(body: Envelope<T>): T {
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

  private sendUpload(path: string, opts: UploadOptions, token: string): Promise<WxUploadResult> {
    return this.wx.uploadFile({
      url: `${this.baseUrl}${path}`,
      filePath: opts.filePath,
      name: opts.name ?? 'file',
      formData: opts.formData,
      // 只有 Authorization：content-type 由 wx 连 boundary 一起填。
      header: { Authorization: `Bearer ${token}` },
    });
  }

  private isUnauthorized(statusCode: number, code: number | undefined): boolean {
    return statusCode === 401 || code === ERROR_CODES.UNAUTHORIZED;
  }
}

/** 解上传的字符串信封。不是 JSON、或者形状不对，都当「没有信封」处理。 */
function parseEnvelope<T>(raw: string): Envelope<T> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && typeof (parsed as Envelope<T>).code === 'number') {
      return parsed as Envelope<T>;
    }
  } catch {
    // 落到下面返回 null，由调用方换成 ApiError。
  }
  return null;
}
