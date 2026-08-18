import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ApiResponse, ERROR_CODES } from '@paws/types';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<ApiResponse<unknown>> {
    return next
      .handle()
      .pipe(map((data) => ({ code: ERROR_CODES.OK, message: 'ok', data: data ?? null })));
  }
}
