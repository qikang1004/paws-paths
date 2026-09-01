import { ERROR_CODES, messageForCode, type ApiResponse } from '@paws/types';
import { clearSession, loadSession } from './session';

/**
 * 服务端的统一包络：`{ code, message, data }`（见 `ResponseInterceptor` 与
 * `AllExceptionsFilter`）。**HTTP 状态不是判据** —— 业务码才是，这与小程序侧
 * 的约定一致。所以这里只在网络层失败时才看 `response.ok`。
 */
export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 令牌失效时抛这个。路由层据此把人送回登录页，不必去比对 code 数值。 */
export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(ERROR_CODES.UNAUTHORIZED, message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * `/api` 前缀由 Vite（开发）或 Nginx（生产）反代到服务端，见 `vite.config.ts`。
 * 写成常量而不是环境变量：两侧都反代同一个前缀，编译期分支只会让「生产忘了配」
 * 变成可能。
 */
const BASE = '/api';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = loadSession();
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  // 令牌只在有会话时带。没有会话也照发请求 —— 服务端的 401 是唯一的真相，
  // 前端提前拦下只会让「令牌过期了但本地还留着」这种情况表现成静默无响应。
  if (session) headers.set('Authorization', `Bearer ${session.token}`);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    // fetch 只在网络层失败时 reject（断网、DNS、被拦）。这不是业务错误，
    // 没有业务码可给 —— 用 INTERNAL 兜着，文案说清是网络问题。
    throw new ApiError(ERROR_CODES.INTERNAL, '网络不可用，请检查连接后重试');
  }

  const envelope = await readEnvelope(response);

  if (envelope.code === ERROR_CODES.UNAUTHORIZED) {
    // 令牌过期或被撤：**就地清掉本地会话**。留着它会让下一次请求再撞一次 401，
    // 而路由守卫看的是本地会话，不清就会在「已登录」的外观下反复失败。
    clearSession();
    throw new UnauthorizedError(envelope.message || messageForCode(ERROR_CODES.UNAUTHORIZED));
  }
  if (envelope.code !== ERROR_CODES.OK) {
    throw new ApiError(envelope.code, envelope.message || messageForCode(envelope.code));
  }
  return envelope.data as T;
}

/**
 * 把响应读成包络。**非包络响应也要有确定的形状** —— 反代挂了会回一段 HTML，
 * 直接 `.json()` 会抛出一个与业务无关的 SyntaxError，那种报错在界面上
 * 表现成「操作失败：Unexpected token <」，对运营毫无意义。
 */
async function readEnvelope(response: Response): Promise<ApiResponse<unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      code: response.status === 401 ? ERROR_CODES.UNAUTHORIZED : ERROR_CODES.INTERNAL,
      message: `服务端返回了非预期的内容（HTTP ${response.status}）`,
      data: null,
    };
  }
  if (typeof body !== 'object' || body === null || typeof (body as ApiResponse<unknown>).code !== 'number') {
    return {
      code: ERROR_CODES.INTERNAL,
      message: `服务端返回了非预期的内容（HTTP ${response.status}）`,
      data: null,
    };
  }
  return body as ApiResponse<unknown>;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
};
