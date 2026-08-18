/** 统一的前端错误：code 是业务错误码，message 已是可直接展示的中文。 */
export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
