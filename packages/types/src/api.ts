export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

export const ERROR_CODES = {
  OK: 0,
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  VALIDATION_FAILED: 42200,
  AUDIT_REJECTED: 42201,
  LOCATION_REQUIRED: 42202,
  FOLLOW_SELF: 42203,
  RATE_LIMITED: 42900,
  INTERNAL: 50000,
  UPSTREAM_WECHAT: 50201,
  UPSTREAM_MAP: 50202,
  /**
   * 内容安全接口不可用。与 `UPSTREAM_WECHAT` 分开是因为处置不同：
   * 内容安全是 fail-closed（宁可拒发也不能放过未审内容），前端要提示「稍后重试」
   * 而不是当成一般的微信故障静默降级。
   */
  UPSTREAM_WECHAT_SECURITY: 50203,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const FALLBACK_MESSAGE = '服务异常，请稍后再试';

export const ERROR_MESSAGES: Record<number, string> = {
  [ERROR_CODES.UNAUTHORIZED]: '登录已过期，请重试',
  [ERROR_CODES.FORBIDDEN]: '没有操作权限',
  [ERROR_CODES.NOT_FOUND]: '内容不存在或已删除',
  [ERROR_CODES.VALIDATION_FAILED]: '提交的信息有误，请检查后重试',
  [ERROR_CODES.AUDIT_REJECTED]: '内容未通过审核',
  [ERROR_CODES.LOCATION_REQUIRED]: '该功能需要位置信息',
  [ERROR_CODES.FOLLOW_SELF]: '不能关注自己的宠物',
  [ERROR_CODES.RATE_LIMITED]: '操作太频繁，请稍后再试',
  [ERROR_CODES.INTERNAL]: FALLBACK_MESSAGE,
  [ERROR_CODES.UPSTREAM_WECHAT]: '微信服务暂时不可用',
  [ERROR_CODES.UPSTREAM_MAP]: '地图服务暂时不可用',
  [ERROR_CODES.UPSTREAM_WECHAT_SECURITY]: '内容审核服务暂时不可用，请稍后重试',
};

export function messageForCode(code: number, fallbackFromServer?: string): string {
  return fallbackFromServer || ERROR_MESSAGES[code] || FALLBACK_MESSAGE;
}
