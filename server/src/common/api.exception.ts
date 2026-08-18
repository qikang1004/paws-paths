import { HttpException, HttpStatus } from '@nestjs/common';
import { messageForCode } from '@paws/types';

/** 业务码与 HTTP 状态分离：前端只认业务码，HTTP 状态给网关和监控看。 */
export class ApiException extends HttpException {
  constructor(
    readonly code: number,
    message?: string,
    httpStatus: number = HttpStatus.BAD_REQUEST,
  ) {
    super(messageForCode(code, message), httpStatus);
  }
}
