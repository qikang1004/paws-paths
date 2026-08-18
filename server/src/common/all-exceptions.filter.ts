import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ERROR_CODES, messageForCode } from '@paws/types';
import { ApiException } from './api.exception';

const HTTP_TO_CODE: Record<number, number> = {
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();

    if (exception instanceof ApiException) {
      res.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        data: null,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = HTTP_TO_CODE[status] ?? ERROR_CODES.INTERNAL;
      res.status(status).json({ code, message: messageForCode(code), data: null });
      return;
    }

    // 未预期异常：日志留全量，响应只给兜底文案。
    this.logger.error(exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ERROR_CODES.INTERNAL,
      message: messageForCode(ERROR_CODES.INTERNAL),
      data: null,
    });
  }
}
