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
  RATE_LIMITED: 42900,
  INTERNAL: 50000,
  UPSTREAM_WECHAT: 50201,
  UPSTREAM_MAP: 50202,
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
  [ERROR_CODES.RATE_LIMITED]: '操作太频繁，请稍后再试',
  [ERROR_CODES.INTERNAL]: FALLBACK_MESSAGE,
  [ERROR_CODES.UPSTREAM_WECHAT]: '微信服务暂时不可用',
  [ERROR_CODES.UPSTREAM_MAP]: '地图服务暂时不可用',
};

export function messageForCode(code: number, fallbackFromServer?: string): string {
  return fallbackFromServer || ERROR_MESSAGES[code] || FALLBACK_MESSAGE;
}
